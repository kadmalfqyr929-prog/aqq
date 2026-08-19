import base64
import io
import json
import os
from decimal import Decimal
from datetime import datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone

from . import api
from .analytics import analytics_revision
from .authentication import create_access_token
from .models import AppSnapshot, AccountMovement, AuditLog, Client, ClientPayment, Employee, EmployeePayroll, Invoice, InvoiceItem, LedgerEntry, Product, ProductImage, ProductUnit, Purchase, PurchaseItem, StockBatch, StockMovement, Supplier, SupplierPayment, UserProfile, Warehouse
from .services import calculate_customer_balance, calculate_supplier_balance


class BackupRetentionTests(TestCase):
    def test_prune_backup_files_keeps_latest_internal_files_only(self):
        from .backup_retention import prune_backup_files

        with TemporaryDirectory() as directory:
            backup_dir = Path(directory)
            files = [
                "before-restore-20260604-111111.json",
                "before-restore-20260605-111111.json",
                "db-2026-06-04.sqlite3",
                "db-2026-06-05.sqlite3",
                "final-safety-before-clean-20260603-002004.json",
                "customer-export.json",
            ]
            for index, name in enumerate(files):
                path = backup_dir / name
                path.write_text("{}", encoding="utf-8")
                os.utime(path, (index + 1, index + 1))

            report = prune_backup_files(backup_dir, apply=True)

            self.assertTrue((backup_dir / "before-restore-20260605-111111.json").exists())
            self.assertTrue((backup_dir / "db-2026-06-05.sqlite3").exists())
            self.assertTrue((backup_dir / "customer-export.json").exists())
            self.assertFalse((backup_dir / "before-restore-20260604-111111.json").exists())
            self.assertFalse((backup_dir / "db-2026-06-04.sqlite3").exists())
            self.assertFalse((backup_dir / "final-safety-before-clean-20260603-002004.json").exists())
            self.assertEqual(report["after"]["unknownCount"], 1)
            self.assertEqual({item["reason"] for item in report["deleted"]}, {"old-before-restore", "old-daily-db", "old-final-safety"})


class FinancialLedgerApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_superuser(username="admin", password="pass")
        self.client.force_login(self.user)
        self.warehouse = Warehouse.objects.create(external_id="wh-test", name="Test Warehouse")
        self.product = Product.objects.create(
            external_id="prod-test",
            warehouse=self.warehouse,
            name="Test Product",
            stock_quantity=Decimal("1000.0000"),
            stock_unit_name="piece",
            stock_unit_multiplier=Decimal("1.0000"),
            purchase_cost_usd=Decimal("25.0000"),
        )
        StockBatch.objects.create(
            product=self.product,
            warehouse=self.warehouse,
            batch_code="OPENING-prod-test",
            quantity=Decimal("1000.0000"),
            purchase_cost_usd=Decimal("25.0000"),
        )
        self.unit = ProductUnit.objects.create(
            external_id="unit-test",
            product=self.product,
            name="piece",
            multiplier=Decimal("1.0000"),
            price_usd=Decimal("100.0000"),
        )

    def invoice_item(self, qty="1", price="100.00", total="100.00"):
        return {
            "productId": self.product.external_id,
            "warehouseId": self.warehouse.external_id,
            "unitId": self.unit.external_id,
            "unitName": self.unit.name,
            "qty": qty,
            "qtyInBase": qty,
            "priceUsd": price,
            "totalUsd": total,
        }

    def purchase_item(self, qty="1", cost="25.00", total="25.00", **overrides):
        item = {
            "productId": self.product.external_id,
            "warehouseId": self.warehouse.external_id,
            "unitId": self.unit.external_id,
            "unitName": self.unit.name,
            "quantity": qty,
            "qtyInBase": qty,
            "unitCostUsd": cost,
            "totalUsd": total,
        }
        item.update(overrides)
        return item

    def test_invalid_json_returns_explicit_bad_request(self):
        response = self.client.post("/api/auth/login/", data="{", content_type="application/json")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["reason"], "INVALID_JSON")

    def test_login_does_not_create_default_admin_without_dev_flag(self):
        self.client.logout()
        User.objects.filter(username="user").delete()

        response = self.client.post(
            "/api/auth/login/",
            data=json.dumps({"username": "user", "password": "blocked-default-pass"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 401)
        self.assertFalse(User.objects.filter(username="user").exists())

    def create_profit_invoice_row(self, external_id, created_at, *, product=None, unit=None, revenue="100.00", cogs="25.00", quantity="1", cost_source="fifo_ok", kind="invoice"):
        product = product or self.product
        unit = unit or self.unit
        revenue = Decimal(str(revenue))
        cogs = Decimal(str(cogs))
        quantity = Decimal(str(quantity))
        invoice = Invoice.objects.create(
            external_id=external_id,
            customer_name="Walk in",
            kind=kind,
            subtotal_usd=revenue,
            total_usd=revenue,
            paid_usd=revenue,
            payment_status="paid",
            created_at=created_at,
        )
        InvoiceItem.objects.create(
            invoice=invoice,
            product=product,
            warehouse=self.warehouse,
            unit_id=unit.external_id,
            unit_name=unit.name,
            quantity=quantity,
            qty_in_base=quantity,
            price_usd=revenue / quantity if quantity else revenue,
            total_usd=revenue,
            unit_cost_usd=cogs / quantity if quantity else cogs,
            total_cost_usd=cogs,
            gross_profit_usd=revenue - cogs,
            cost_status="ok",
            cost_breakdown=[{
                "source": cost_source,
                "batchCode": f"TEST-{cost_source}-{external_id}",
                "quantity": float(quantity),
                "unitCostUsd": float(cogs / quantity if quantity else cogs),
                "costUsd": float(cogs),
            }] if cost_source else [],
        )
        return invoice

    def sync_payload(self, **overrides):
        payload = {
            "theme": "coffee",
            "lang": "ar",
            "dir": "rtl",
            "currency": "IQD",
            "exchangeRate": 1460,
            "warehouses": [
                {
                    "id": self.warehouse.external_id,
                    "name": self.warehouse.name,
                    "code": self.warehouse.code,
                    "zone": "",
                    "manager": "",
                    "color": self.warehouse.color,
                    "note": "",
                }
            ],
            "products": [
                {
                    "id": self.product.external_id,
                    "name": self.product.name,
                    "brand": self.product.brand,
                    "originCountry": self.product.origin_country,
                    "kind": self.product.kind,
                    "barcode": self.product.barcode,
                    "sku": self.product.sku,
                    "warehouseId": self.warehouse.external_id,
                    "currency": self.product.currency,
                    "baseUnit": self.product.base_unit,
                    "stockUnitName": self.product.stock_unit_name,
                    "stockUnitMultiplier": str(self.product.stock_unit_multiplier),
                    "stockQuantity": str(self.product.stock_quantity),
                    "purchaseCostUsd": str(self.product.purchase_cost_usd),
                    "alertQuantity": str(self.product.alert_quantity),
                    "units": [
                        {
                            "id": self.unit.external_id,
                            "name": self.unit.name,
                            "multiplier": str(self.unit.multiplier),
                            "priceUsd": str(self.unit.price_usd),
                            "priceCurrency": self.unit.price_currency,
                            "barcode": self.unit.barcode,
                        }
                    ],
                }
            ],
            "clients": [],
            "suppliers": [],
            "employees": [],
            "invoices": [],
            "purchases": [],
            "clientPayments": [],
            "supplierPayments": [],
            "accountMovements": [],
            "suspendedInvoices": [],
            "suspendedPurchases": [],
            "unitPresets": [],
            "brands": [],
            "originCountries": [],
            "invoicePrintSettings": {
                "defaultTemplate": "official-a4",
                "paperSize": "a4",
                "accentColor": "#0f766e",
                "fontScale": 100,
                "density": "normal",
                "logoMode": "mark",
                "showFields": {"phone": True, "address": True, "paidRemaining": True},
                "perDocumentType": {"directSale": {"template": "thermal-80", "paperSize": "thermal-80", "density": "compact"}},
            },
        }
        payload.update(overrides)
        return payload

    def test_financial_actions_create_immutable_ledger_entries(self):
        customer_response = self.client.post(
            "/api/customers/",
            data={
                "id": "cust-1",
                "name": "Acme",
                "openingBalanceUsd": "25.00",
                "openingBalanceType": "debit",
            },
            content_type="application/json",
        )
        self.assertEqual(customer_response.status_code, 201)

        invoice_response = self.client.post(
            "/api/invoices/",
            data={
                "id": "inv-1",
                "customerId": "cust-1",
                "totalUsd": "100.00",
                "subtotalUsd": "100.00",
                "paidUsd": "0.00",
                "items": [self.invoice_item()],
            },
            content_type="application/json",
        )
        self.assertEqual(invoice_response.status_code, 201)

        payment_response = self.client.post(
            "/api/payments/",
            data={"id": "pay-1", "customerId": "cust-1", "amountUsd": "40.00"},
            content_type="application/json",
        )
        self.assertEqual(payment_response.status_code, 201)

        statement_response = self.client.get("/api/statements/?entityType=customer&entityId=cust-1")
        self.assertEqual(statement_response.status_code, 200)
        self.assertEqual(statement_response.json()["balanceUsd"], 85.0)
        self.assertEqual(calculate_customer_balance("cust-1"), Decimal("85.0000"))
        self.assertEqual(
            list(LedgerEntry.objects.filter(entity_id="cust-1").order_by("timestamp", "id").values_list("type", flat=True)),
            [
                LedgerEntry.TYPE_DEBT_ADJUSTMENT,
                LedgerEntry.TYPE_INVOICE_CREATED,
                LedgerEntry.TYPE_PAYMENT_RECEIVED,
            ],
        )

        entry = LedgerEntry.objects.get(reference_id="inv-1")
        entry.amount_usd = Decimal("99.00")
        with self.assertRaises(ValueError):
            entry.save()
        with self.assertRaises(ValueError):
            LedgerEntry.objects.filter(pk=entry.pk).update(amount_usd=Decimal("99.00"))

    def test_customer_invoice_partial_payment_creates_payment_and_balance(self):
        self.client.post(
            "/api/customers/",
            data={"id": "cust-partial", "name": "Partial Customer"},
            content_type="application/json",
        )

        response = self.client.post(
            "/api/invoices/",
            data={
                "id": "inv-partial",
                "customerId": "cust-partial",
                "paymentId": "pay-initial-partial",
                "subtotalUsd": "100.00",
                "totalUsd": "100.00",
                "paidUsd": "60.00",
                "items": [self.invoice_item()],
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201)
        invoice = Invoice.objects.get(external_id="inv-partial")
        payment = ClientPayment.objects.get(external_id="pay-initial-partial")
        self.assertEqual(invoice.paid_usd, Decimal("60.0000"))
        self.assertEqual(invoice.remaining_usd, Decimal("40.0000"))
        self.assertEqual(payment.amount_usd, Decimal("60.0000"))
        self.assertEqual(payment.applied_to, [{"invoiceId": "inv-partial", "amountUsd": 60.0}])
        self.assertEqual(calculate_customer_balance("cust-partial"), Decimal("40.0000"))
        self.assertEqual(
            list(LedgerEntry.objects.filter(entity_id="cust-partial").order_by("timestamp", "id").values_list("type", flat=True)),
            [LedgerEntry.TYPE_INVOICE_CREATED, LedgerEntry.TYPE_PAYMENT_RECEIVED],
        )

    def test_sync_backfills_legacy_invoice_initial_payment_once(self):
        payload = self.sync_payload(
            clients=[{"id": "cust-legacy-paid", "name": "Legacy Paid Customer", "phone": "", "openingBalanceUsd": "0"}],
            invoices=[
                {
                    "id": "inv-legacy-paid",
                    "clientId": "cust-legacy-paid",
                    "customerName": "Legacy Paid Customer",
                    "kind": "invoice",
                    "subtotalUsd": "100.00",
                    "discountUsd": "0.00",
                    "totalUsd": "100.00",
                    "paidUsd": "60.00",
                    "remainingUsd": "40.00",
                    "paymentStatus": "partial",
                    "items": [self.invoice_item()],
                }
            ],
            clientPayments=[],
        )

        first = self.client.post("/api/sync/", data=payload, content_type="application/json")
        second = self.client.post("/api/sync/", data=payload, content_type="application/json")

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(ClientPayment.objects.filter(client__external_id="cust-legacy-paid").count(), 1)
        payment = ClientPayment.objects.get(client__external_id="cust-legacy-paid")
        self.assertEqual(payment.external_id, "invoice-payment-inv-legacy-paid")
        self.assertEqual(payment.amount_usd, Decimal("60.0000"))
        self.assertEqual(payment.applied_to, [{"invoiceId": "inv-legacy-paid", "amountUsd": 60.0}])
        self.assertEqual(calculate_customer_balance("cust-legacy-paid"), Decimal("40.0000"))

    def test_sync_does_not_backfill_when_incoming_payment_covers_invoice(self):
        payload = self.sync_payload(
            clients=[{"id": "cust-incoming-paid", "name": "Incoming Paid Customer", "phone": "", "openingBalanceUsd": "0"}],
            invoices=[
                {
                    "id": "inv-incoming-paid",
                    "clientId": "cust-incoming-paid",
                    "customerName": "Incoming Paid Customer",
                    "kind": "invoice",
                    "subtotalUsd": "100.00",
                    "discountUsd": "0.00",
                    "totalUsd": "100.00",
                    "paidUsd": "60.00",
                    "remainingUsd": "40.00",
                    "paymentStatus": "partial",
                    "items": [self.invoice_item()],
                }
            ],
            clientPayments=[
                {
                    "id": "pay-incoming-paid",
                    "clientId": "cust-incoming-paid",
                    "clientName": "Incoming Paid Customer",
                    "amountUsd": "60.00",
                    "unappliedUsd": "0.00",
                    "appliedTo": [{"invoiceId": "inv-incoming-paid", "amountUsd": 60.0}],
                }
            ],
        )

        response = self.client.post("/api/sync/", data=payload, content_type="application/json")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(ClientPayment.objects.filter(client__external_id="cust-incoming-paid").count(), 1)
        self.assertTrue(ClientPayment.objects.filter(external_id="pay-incoming-paid").exists())
        self.assertFalse(ClientPayment.objects.filter(external_id="invoice-payment-inv-incoming-paid").exists())
        self.assertEqual(calculate_customer_balance("cust-incoming-paid"), Decimal("40.0000"))

    def test_invoice_totals_are_recalculated_with_decimal_precision(self):
        self.client.post(
            "/api/customers/",
            data={"id": "cust-precision", "name": "Precision Customer"},
            content_type="application/json",
        )

        response = self.client.post(
            "/api/invoices/",
            data={
                "id": "inv-precision",
                "customerId": "cust-precision",
                "subtotalUsd": "500000.00",
                "totalUsd": "500000.00",
                "items": [self.invoice_item(qty="50", price="10000", total="500000")],
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201)
        invoice = Invoice.objects.get(external_id="inv-precision")
        item = InvoiceItem.objects.get(invoice=invoice)
        self.assertEqual(invoice.total_usd, Decimal("500000.0000"))
        self.assertEqual(item.total_usd, Decimal("500000.0000"))

    def test_customer_invoice_accepts_line_discount_from_pos_payload(self):
        response = self.client.post(
            "/api/invoices/",
            data={
                "id": "inv-line-discount",
                "subtotalUsd": "90.00",
                "totalUsd": "90.00",
                "paidUsd": "90.00",
                "items": [
                    {
                        **self.invoice_item(qty="1", price="100.00", total="90.00"),
                        "lineDiscountPercent": "10",
                        "lineDiscountUsd": "10.00",
                    }
                ],
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201, response.json())
        invoice = Invoice.objects.get(external_id="inv-line-discount")
        item = InvoiceItem.objects.get(invoice=invoice)
        self.assertEqual(invoice.subtotal_usd, Decimal("90.0000"))
        self.assertEqual(invoice.total_usd, Decimal("90.0000"))
        self.assertEqual(item.total_usd, Decimal("90.0000"))

    def test_backend_generates_sequential_invoice_ids_when_missing(self):
        self.client.post(
            "/api/customers/",
            data={"id": "cust-sequence", "name": "Sequence Customer"},
            content_type="application/json",
        )

        first = self.client.post(
            "/api/invoices/",
            data={
                "customerId": "cust-sequence",
                "createdAt": "2026-05-24T08:00:00+03:00",
                "items": [self.invoice_item(price="10", total="10")],
            },
            content_type="application/json",
        )
        second = self.client.post(
            "/api/invoices/",
            data={
                "customerId": "cust-sequence",
                "createdAt": "2026-05-24T09:00:00+03:00",
                "items": [self.invoice_item(price="20", total="20")],
            },
            content_type="application/json",
        )

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 201)
        self.assertEqual(first.json()["invoice"]["id"], "INV-20260524-0001")
        self.assertEqual(second.json()["invoice"]["id"], "INV-20260524-0002")

    def test_direct_pos_invoice_kind_round_trips_and_filters(self):
        self.client.post(
            "/api/customers/",
            data={"id": "cust-direct-pos", "name": "Direct POS Customer"},
            content_type="application/json",
        )

        response = self.client.post(
            "/api/invoices/",
            data={
                "kind": "direct_pos",
                "customerId": "cust-direct-pos",
                "paidUsd": "100",
                "items": [self.invoice_item(price="100", total="100")],
            },
            content_type="application/json",
        )
        filtered = self.client.get("/api/invoices/?kind=direct_pos")

        self.assertEqual(response.status_code, 201)
        invoice_payload = response.json()["invoice"]
        self.assertEqual(invoice_payload["kind"], "direct_pos")
        self.assertEqual(invoice_payload["paymentStatus"], "paid")
        self.assertEqual(Decimal(str(invoice_payload["paidUsd"])), Decimal("100.0"))
        self.assertEqual(Decimal(str(invoice_payload["remainingUsd"])), Decimal("0.0"))
        self.assertEqual(Invoice.objects.get(external_id=invoice_payload["id"]).kind, "direct_pos")
        self.assertEqual(filtered.status_code, 200)
        self.assertEqual(filtered.json()["invoices"][0]["kind"], "direct_pos")
        self.assertEqual(filtered.json()["invoices"][0]["paymentStatus"], "paid")

    def test_backend_generates_sequential_purchase_ids_when_missing(self):
        self.client.post(
            "/api/suppliers/",
            data={"id": "sup-sequence", "name": "Sequence Supplier"},
            content_type="application/json",
        )

        first = self.client.post(
            "/api/purchases-ledger/",
            data={
                "supplierId": "sup-sequence",
                "createdAt": "2026-05-24T08:00:00+03:00",
                "paidUsd": "25",
                "items": [self.purchase_item()],
            },
            content_type="application/json",
        )
        second = self.client.post(
            "/api/purchases-ledger/",
            data={
                "supplierId": "sup-sequence",
                "createdAt": "2026-05-24T09:00:00+03:00",
                "paidUsd": "50",
                "items": [self.purchase_item(cost="50", total="50")],
            },
            content_type="application/json",
        )

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 201)
        self.assertEqual(first.json()["purchase"]["id"], "PUR-20260524-0001")
        self.assertEqual(second.json()["purchase"]["id"], "PUR-20260524-0002")

    def test_direct_supplier_purchase_with_partial_payment_creates_financial_records(self):
        self.client.post(
            "/api/suppliers/",
            data={"id": "sup-direct", "name": "Direct Supplier"},
            content_type="application/json",
        )

        response = self.client.post(
            "/api/purchases-ledger/",
            data={
                "id": "pur-direct",
                "supplierId": "sup-direct",
                "paidUsd": "10.00",
                "items": [self.purchase_item(qty="2", cost="25.00", total="50.00")],
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201)
        purchase = Purchase.objects.get(external_id="pur-direct")
        self.assertEqual(purchase.paid_usd, Decimal("10.0000"))
        self.assertEqual(purchase.remaining_usd, Decimal("40.0000"))
        self.assertEqual(PurchaseItem.objects.filter(purchase=purchase).count(), 1)
        self.assertEqual(SupplierPayment.objects.filter(supplier__external_id="sup-direct").count(), 1)
        self.assertEqual(LedgerEntry.objects.filter(entity_id="sup-direct").count(), 2)
        self.assertEqual(AccountMovement.objects.filter(party_id="sup-direct").count(), 2)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_quantity, Decimal("1002.0000"))
        self.assertEqual(calculate_supplier_balance("sup-direct"), Decimal("40.0000"))

    def test_direct_purchase_without_supplier_saves_stock_without_supplier_debt(self):
        response = self.client.post(
            "/api/purchases-ledger/",
            data={
                "id": "pur-no-supplier",
                "paidUsd": "25.00",
                "items": [self.purchase_item(qty="1", cost="25.00", total="25.00")],
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201)
        purchase = Purchase.objects.get(external_id="pur-no-supplier")
        self.assertIsNone(purchase.supplier)
        self.assertEqual(PurchaseItem.objects.filter(purchase=purchase).count(), 1)
        self.assertEqual(LedgerEntry.objects.count(), 0)
        self.assertEqual(AccountMovement.objects.count(), 0)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_quantity, Decimal("1001.0000"))

    def test_quick_purchase_with_supplier_paid_in_full_tracks_supplier_without_debt(self):
        self.client.post(
            "/api/suppliers/",
            data={"id": "sup-quick", "name": "Quick Supplier"},
            content_type="application/json",
        )

        response = self.client.post(
            "/api/purchases-ledger/",
            data={
                "id": "pur-quick-supplier",
                "supplierId": "sup-quick",
                "supplierName": "Quick Supplier",
                "paidUsd": "25.00",
                "items": [self.purchase_item(qty="1", cost="25.00", total="25.00")],
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201)
        purchase = Purchase.objects.get(external_id="pur-quick-supplier")
        self.assertEqual(purchase.supplier.external_id, "sup-quick")
        self.assertEqual(purchase.paid_usd, Decimal("25.0000"))
        self.assertEqual(purchase.remaining_usd, Decimal("0.0000"))
        self.assertEqual(purchase.payment_status, "paid")
        self.assertEqual(calculate_supplier_balance("sup-quick"), Decimal("0.0000"))
        self.assertEqual(SupplierPayment.objects.filter(supplier__external_id="sup-quick").count(), 1)
        self.assertEqual(LedgerEntry.objects.filter(entity_id="sup-quick").count(), 2)

    def test_purchase_batches_keep_expiry_independent_and_product_uses_earliest_open_expiry(self):
        first = self.client.post(
            "/api/purchases-ledger/",
            data={
                "id": "pur-expiry-late",
                "paidUsd": "25.00",
                "items": [self.purchase_item(batchCode="LOT-LATE", expiresAt="2026-12-31T12:00:00+03:00")],
            },
            content_type="application/json",
        )
        second = self.client.post(
            "/api/purchases-ledger/",
            data={
                "id": "pur-expiry-early",
                "paidUsd": "25.00",
                "items": [self.purchase_item(batchCode="LOT-EARLY", expiresAt="2026-07-15T12:00:00+03:00")],
            },
            content_type="application/json",
        )

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 201)
        self.assertEqual(StockBatch.objects.get(batch_code="LOT-LATE").expiry_date.isoformat(), "2026-12-31")
        self.assertEqual(StockBatch.objects.get(batch_code="LOT-EARLY").expiry_date.isoformat(), "2026-07-15")

        state_response = self.client.get("/api/state/")
        self.assertEqual(state_response.status_code, 200)
        product_payload = next(item for item in state_response.json()["products"] if item["id"] == self.product.external_id)
        self.assertEqual(product_payload["expiresAt"], "2026-07-15")
        self.assertEqual(product_payload["nearestBatchExpiresAt"], "2026-07-15")

    def test_supplier_payment_endpoint_updates_purchase_debt_and_financial_records(self):
        self.client.post(
            "/api/suppliers/",
            data={"id": "sup-pay", "name": "Payment Supplier"},
            content_type="application/json",
        )
        self.client.post(
            "/api/purchases-ledger/",
            data={
                "id": "pur-pay",
                "supplierId": "sup-pay",
                "paidUsd": "0.00",
                "items": [self.purchase_item(qty="2", cost="25.00", total="50.00")],
            },
            content_type="application/json",
        )

        response = self.client.post(
            "/api/payments/",
            data={"id": "spay-direct", "supplierId": "sup-pay", "purchaseId": "pur-pay", "amountUsd": "15.00"},
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201)
        purchase = Purchase.objects.get(external_id="pur-pay")
        self.assertEqual(purchase.paid_usd, Decimal("15.0000"))
        self.assertEqual(purchase.remaining_usd, Decimal("35.0000"))
        self.assertEqual(SupplierPayment.objects.get(external_id="spay-direct").applied_to[0]["purchaseId"], "pur-pay")
        self.assertEqual(LedgerEntry.objects.filter(entity_id="sup-pay").count(), 2)
        self.assertEqual(AccountMovement.objects.filter(party_id="sup-pay").count(), 2)
        self.assertEqual(calculate_supplier_balance("sup-pay"), Decimal("35.0000"))

    def test_sync_accepts_iso_datetime_for_product_date_fields(self):
        payload = self.sync_payload(products=[{
            "id": "prod-iso-date",
            "name": "ISO Date Product",
            "warehouseId": self.warehouse.external_id,
            "expiresAt": "2026-08-24T13:42:37.272Z",
            "units": [{
                "id": "unit-iso-date",
                "name": "piece",
                "multiplier": "1",
                "priceUsd": "1",
            }],
        }])

        response = self.client.post("/api/sync/", data=payload, content_type="application/json")

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["syncHasErrors"])
        self.assertEqual(Product.objects.get(external_id="prod-iso-date").expires_at.isoformat(), "2026-08-24")

    def test_sync_invalid_product_date_returns_partial_error_without_blocking_other_sections(self):
        payload = self.sync_payload(
            suppliers=[{"id": "sup-valid-section", "name": "Valid Section Supplier"}],
            products=[{
                "id": "prod-bad-date",
                "name": "Bad Date Product",
                "warehouseId": self.warehouse.external_id,
                "expiresAt": "20226-08-24",
                "units": [{
                    "id": "unit-bad-date",
                    "name": "piece",
                    "multiplier": "1",
                    "priceUsd": "1",
                }],
            }],
        )

        response = self.client.post("/api/sync/", data=payload, content_type="application/json")
        body = response.json()

        self.assertEqual(response.status_code, 207)
        self.assertTrue(body["syncHasErrors"])
        self.assertEqual(body["syncReport"]["errors"][0]["section"], "products")
        self.assertEqual(body["syncReport"]["errors"][0]["code"], "VALIDATION_ERROR")
        self.assertTrue(Supplier.objects.filter(external_id="sup-valid-section").exists())
        self.assertFalse(Product.objects.filter(external_id="prod-bad-date").exists())

    def product_payload(self, external_id, *, barcode="", unit_barcode="", unit_id=None, price="10.00"):
        return {
            "id": external_id,
            "name": f"Product {external_id}",
            "warehouseId": self.warehouse.external_id,
            "currency": "USD",
            "stockQuantity": "1",
            "stockUnitMultiplier": "1",
            "purchaseCostUsd": "1",
            "barcode": barcode,
            "units": [{
                "id": unit_id or f"{external_id}-unit",
                "name": "piece",
                "multiplier": "1",
                "priceUsd": price,
                "priceCurrency": "USD",
                "barcode": unit_barcode,
            }],
        }

    def assert_duplicate_barcode_response(self, response):
        self.assertEqual(response.status_code, 400, response.content)
        body = response.json()
        self.assertEqual(body["reason"], "DUPLICATE_BARCODE")
        self.assertEqual(body["messageAr"], "هذا الباركود مستخدم لمنتج آخر، الرجاء إدخال رقم مختلف")

    def test_product_api_rejects_duplicate_barcode_between_products(self):
        self.product.barcode = "9999"
        self.product.save(update_fields=["barcode"])

        response = self.client.post(
            "/api/products/",
            data=self.product_payload("prod-duplicate-product", barcode="9999"),
            content_type="application/json",
        )

        self.assert_duplicate_barcode_response(response)
        self.assertFalse(Product.objects.filter(external_id="prod-duplicate-product").exists())

    def test_product_api_rejects_duplicate_barcode_between_product_and_unit(self):
        self.unit.barcode = "9999"
        self.unit.save(update_fields=["barcode"])

        response = self.client.post(
            "/api/products/",
            data=self.product_payload("prod-duplicate-product-unit", barcode="9999"),
            content_type="application/json",
        )

        self.assert_duplicate_barcode_response(response)

    def test_product_api_rejects_duplicate_barcode_between_units(self):
        self.unit.barcode = "9999"
        self.unit.save(update_fields=["barcode"])

        response = self.client.post(
            "/api/products/",
            data=self.product_payload("prod-duplicate-unit", unit_barcode="9999"),
            content_type="application/json",
        )

        self.assert_duplicate_barcode_response(response)

    def test_product_patch_without_units_preserves_unit_price(self):
        self.unit.price_usd = Decimal("185.0000")
        self.unit.save(update_fields=["price_usd"])

        response = self.client.patch(
            f"/api/products/{self.product.external_id}/",
            data={"name": "Renamed Product"},
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.unit.refresh_from_db()
        self.assertEqual(self.unit.price_usd, Decimal("185.0000"))

    def test_pos_product_detail_returns_updated_unit_price_after_patch(self):
        self.product.currency = "USD"
        self.product.save(update_fields=["currency"])
        self.unit.price_usd = Decimal("185.0000")
        self.unit.price_currency = "USD"
        self.unit.save(update_fields=["price_usd", "price_currency"])

        patch_response = self.client.patch(
            f"/api/products/{self.product.external_id}/",
            data={
                "units": [{
                    "id": self.unit.external_id,
                    "name": self.unit.name,
                    "multiplier": "1",
                    "priceUsd": "190.0000",
                    "priceCurrency": "USD",
                }],
            },
            content_type="application/json",
        )
        pos_response = self.client.get(f"/api/pos/products/{self.product.external_id}/")

        self.assertEqual(patch_response.status_code, 200, patch_response.content)
        self.assertEqual(pos_response.status_code, 200, pos_response.content)
        unit_payload = next(item for item in pos_response.json()["units"] if item["id"] == self.unit.external_id)
        self.assertEqual(unit_payload["priceUsd"], 190.0)

    def test_invoice_rejects_mismatched_client_totals(self):
        self.client.post(
            "/api/customers/",
            data={"id": "cust-mismatch", "name": "Mismatch Customer"},
            content_type="application/json",
        )

        response = self.client.post(
            "/api/invoices/",
            data={
                "id": "inv-mismatch",
                "customerId": "cust-mismatch",
                "subtotalUsd": "500001.00",
                "totalUsd": "500001.00",
                "items": [self.invoice_item(qty="50", price="10000", total="500000")],
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        body = response.json()
        self.assertEqual(body["reason"], "SUBTOTAL_MISMATCH")
        self.assertEqual(body["details"]["expectedUsd"], 500000.0)
        self.assertEqual(body["details"]["providedUsd"], 500001.0)
        self.assertEqual(body["details"]["differenceUsd"], 1.0)
        self.assertFalse(Invoice.objects.filter(external_id="inv-mismatch").exists())

    def test_invoice_idempotency_key_returns_existing_invoice(self):
        payload = {
            "id": "inv-idempotent",
            "idempotencyKey": "inv-idempotent",
            "customerName": "Walk in",
            "subtotalUsd": "100.00",
            "totalUsd": "100.00",
            "paidUsd": "100.00",
            "items": [self.invoice_item()],
        }

        first = self.client.post("/api/invoices/", data=payload, content_type="application/json")
        second = self.client.post("/api/invoices/", data=payload, content_type="application/json")

        self.assertEqual(first.status_code, 201, first.content)
        self.assertEqual(second.status_code, 201, second.content)
        self.assertEqual(Invoice.objects.filter(external_id="inv-idempotent").count(), 1)
        self.assertEqual(InvoiceItem.objects.filter(invoice__external_id="inv-idempotent").count(), 1)

    def test_sync_rejects_mismatched_invoice_totals(self):
        response = self.client.post(
            "/api/sync/",
            data=self.sync_payload(invoices=[{
                "id": "inv-sync-mismatch",
                "customerName": "Walk in",
                "kind": "invoice",
                "subtotalUsd": "101.00",
                "discountUsd": "0.00",
                "totalUsd": "101.00",
                "paidUsd": "101.00",
                "remainingUsd": "0.00",
                "paymentStatus": "paid",
                "items": [self.invoice_item()],
            }]),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 207, response.content)
        body = response.json()
        self.assertTrue(body["syncHasErrors"])
        self.assertIn("SUBTOTAL_MISMATCH", json.dumps(body["syncReport"]))
        self.assertFalse(Invoice.objects.filter(external_id="inv-sync-mismatch").exists())

    def test_iqd_invoice_line_inherits_invoice_exchange_rate(self):
        product = Product.objects.create(
            external_id="prod-iqd-inherit-rate",
            warehouse=self.warehouse,
            name="IQD Rate Product",
            stock_quantity=Decimal("1.0000"),
            stock_unit_name="piece",
            stock_unit_multiplier=Decimal("1.0000"),
            purchase_cost_usd=Decimal("700.0000"),
            currency="IQD",
        )
        StockBatch.objects.create(
            product=product,
            warehouse=self.warehouse,
            batch_code="OPENING-prod-iqd-inherit-rate",
            quantity=Decimal("1.0000"),
            purchase_cost_usd=Decimal("700.0000"),
        )
        unit = ProductUnit.objects.create(
            external_id="unit-iqd-inherit-rate",
            product=product,
            name="piece",
            multiplier=Decimal("1.0000"),
            price_usd=Decimal("1200.0000"),
            price_currency="IQD",
        )

        response = self.client.post(
            "/api/invoices/",
            data={
                "id": "inv-iqd-inherit-rate",
                "customerName": "Walk in",
                "currency": "IQD",
                "exchangeRate": "1500",
                "subtotalUsd": "1200.00",
                "totalUsd": "1200.00",
                "paidUsd": "1200.00",
                "items": [{
                    "productId": product.external_id,
                    "warehouseId": self.warehouse.external_id,
                    "unitId": unit.external_id,
                    "unitName": unit.name,
                    "qty": "1",
                    "qtyInBase": "1",
                    "price": "1800000",
                    "lineTotal": "1800000",
                    "totalUsd": "1200.00",
                }],
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201, response.content)
        item = InvoiceItem.objects.get(invoice__external_id="inv-iqd-inherit-rate")
        self.assertEqual(item.total_usd, Decimal("1200.0000"))
        self.assertEqual(item.total_cost_usd, Decimal("700.0000"))

    def test_invoice_repairs_legacy_unit_when_product_has_one_active_unit(self):
        response = self.client.post(
            "/api/invoices/",
            data={
                "id": "inv-legacy-unit",
                "customerName": "Walk in",
                "subtotalUsd": "100.00",
                "totalUsd": "100.00",
                "items": [{**self.invoice_item(), "unitId": "old-local-unit", "unit": "old-local-unit"}],
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201)
        item = InvoiceItem.objects.get(invoice__external_id="inv-legacy-unit")
        self.assertEqual(item.unit_id, self.unit.external_id)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_quantity, Decimal("999.0000"))

    def test_invoice_rejects_ambiguous_legacy_unit_without_stock_change(self):
        ProductUnit.objects.create(
            external_id="unit-other-piece",
            product=self.product,
            name="other piece",
            multiplier=Decimal("1.0000"),
            price_usd=Decimal("100.0000"),
        )

        response = self.client.post(
            "/api/invoices/",
            data={
                "id": "inv-ambiguous-unit",
                "customerName": "Walk in",
                "subtotalUsd": "100.00",
                "totalUsd": "100.00",
                "items": [{**self.invoice_item(), "unitId": "old-local-unit", "unitName": "missing"}],
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["reason"], "NO_UNIT")
        self.assertEqual(response.json()["details"]["lineIndex"], 0)
        self.assertFalse(Invoice.objects.filter(external_id="inv-ambiguous-unit").exists())
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_quantity, Decimal("1000.0000"))

    def test_invoice_creates_base_unit_for_product_without_units(self):
        self.unit.delete()

        response = self.client.post(
            "/api/invoices/",
            data={
                "id": "inv-no-units",
                "customerName": "Walk in",
                "subtotalUsd": "100.00",
                "totalUsd": "100.00",
                "items": [{**self.invoice_item(), "unitId": "missing-unit"}],
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertTrue(ProductUnit.objects.filter(product=self.product, external_id=f"{self.product.external_id}-unit").exists())
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_quantity, Decimal("999.0000"))

    def test_duplicate_payment_reference_is_rejected_before_reapplying(self):
        self.client.post(
            "/api/customers/",
            data={"id": "cust-payment", "name": "Payment Customer"},
            content_type="application/json",
        )
        self.client.post(
            "/api/invoices/",
            data={
                "id": "inv-payment",
                "customerId": "cust-payment",
                "items": [self.invoice_item(price="100", total="100")],
            },
            content_type="application/json",
        )

        first = self.client.post(
            "/api/payments/",
            data={"id": "pay-repeat", "customerId": "cust-payment", "amountUsd": "40.00"},
            content_type="application/json",
        )
        second = self.client.post(
            "/api/payments/",
            data={"id": "pay-repeat", "customerId": "cust-payment", "amountUsd": "40.00"},
            content_type="application/json",
        )

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 409)
        self.assertEqual(ClientPayment.objects.filter(external_id="pay-repeat").count(), 1)
        self.assertEqual(calculate_customer_balance("cust-payment"), Decimal("60.0000"))

    def test_dashboard_analytics_endpoint_uses_server_ledger_data(self):
        self.client.post(
            "/api/customers/",
            data={"id": "cust-analytics", "name": "Analytics Customer"},
            content_type="application/json",
        )
        self.client.post(
            "/api/invoices/",
            data={
                "id": "inv-analytics",
                "customerId": "cust-analytics",
                "items": [self.invoice_item(qty="2", price="75.00", total="150.00")],
            },
            content_type="application/json",
        )

        response = self.client.get(
            "/api/analytics/dashboard/",
            HTTP_AUTHORIZATION=f"Bearer {create_access_token(self.user)}",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["reports"]["ledger"]["customerLedgerUsd"], 150.0)
        self.assertEqual(payload["kpis"]["revenue"]["valueUsd"], 150.0)
        self.assertIn("monthlySales", payload["charts"])
        self.assertTrue(payload["revision"])
        self.assertEqual(payload["revision"], payload["analyticsRevision"])

    def test_reports_year_period_filters_sales_and_profit(self):
        current_year = timezone.localdate().year
        inside = timezone.make_aware(datetime(current_year, 2, 15, 10, 0))
        outside = timezone.make_aware(datetime(current_year - 1, 12, 31, 10, 0))
        self.create_profit_invoice_row("inv-period-current-year", inside, revenue="100.00", cogs="25.00")
        self.create_profit_invoice_row("inv-period-previous-year", outside, revenue="200.00", cogs="50.00")

        response = self.client.get(
            "/api/analytics/reports/?period=year",
            HTTP_AUTHORIZATION=f"Bearer {create_access_token(self.user)}",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        reports = payload["reports"]
        self.assertEqual(payload["period"]["key"], "year")
        self.assertEqual(reports["sales"]["revenueUsd"], 100.0)
        self.assertEqual(reports["sales"]["cogsUsd"], 25.0)
        self.assertEqual(reports["sales"]["grossProfitUsd"], 75.0)
        self.assertEqual(reports["sales"]["netProfitUsd"], 75.0)
        self.assertEqual([item["id"] for item in reports["profitInvoices"]], ["inv-period-current-year"])

    def test_reports_include_cash_payment_vouchers_as_period_expenses(self):
        current_year = timezone.localdate().year
        inside = timezone.make_aware(datetime(current_year, 3, 10, 10, 0))
        outside = timezone.make_aware(datetime(current_year, 4, 1, 10, 0))
        AppSnapshot.objects.create(key="default", data={
            "cashVouchers": [
                {"id": "rent-march", "type": "payment", "amountUsd": "125.0000", "createdAt": inside.isoformat(), "party": "Shop owner"},
                {"id": "receipt-march", "type": "receipt", "amountUsd": "40.0000", "createdAt": inside.isoformat()},
                {"id": "rent-april", "type": "payment", "amountUsd": "300.0000", "createdAt": outside.isoformat()},
            ],
        })

        response = self.client.get(
            f"/api/analytics/reports/?period=custom&start={current_year}-03-05&end={current_year}-03-20",
            HTTP_AUTHORIZATION=f"Bearer {create_access_token(self.user)}",
        )

        self.assertEqual(response.status_code, 200)
        reports = response.json()["reports"]
        self.assertEqual(reports["sales"]["expensesUsd"], 125.0)
        self.assertEqual(reports["sales"]["cashVoucherExpensesUsd"], 125.0)
        self.assertEqual(reports["ledger"]["expensesUsd"], 125.0)
        self.assertEqual(reports["sales"]["netProfitUsd"], -125.0)

    def test_reports_custom_period_excludes_invoices_outside_range(self):
        current_year = timezone.localdate().year
        inside = timezone.make_aware(datetime(current_year, 3, 10, 10, 0))
        before = timezone.make_aware(datetime(current_year, 3, 1, 10, 0))
        after = timezone.make_aware(datetime(current_year, 4, 1, 10, 0))
        self.create_profit_invoice_row("inv-custom-inside", inside, revenue="90.00", cogs="30.00")
        self.create_profit_invoice_row("inv-custom-before", before, revenue="200.00", cogs="50.00")
        self.create_profit_invoice_row("inv-custom-after", after, revenue="300.00", cogs="60.00")

        response = self.client.get(
            f"/api/analytics/reports/?period=custom&start={current_year}-03-05&end={current_year}-03-20",
            HTTP_AUTHORIZATION=f"Bearer {create_access_token(self.user)}",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        reports = payload["reports"]
        self.assertEqual(payload["period"]["key"], "custom")
        self.assertEqual(reports["sales"]["revenueUsd"], 90.0)
        self.assertEqual(reports["sales"]["cogsUsd"], 30.0)
        self.assertEqual([item["id"] for item in reports["profitInvoices"]], ["inv-custom-inside"])

    def test_reports_week_period_filters_current_week(self):
        today = timezone.localdate()
        week_start = today - timedelta(days=today.weekday())
        inside = timezone.make_aware(datetime.combine(week_start, datetime.min.time()).replace(hour=10))
        before = timezone.make_aware(datetime.combine(week_start - timedelta(days=1), datetime.min.time()).replace(hour=10))
        self.create_profit_invoice_row("inv-week-inside", inside, revenue="70.00", cogs="20.00")
        self.create_profit_invoice_row("inv-week-before", before, revenue="200.00", cogs="50.00")

        response = self.client.get(
            "/api/analytics/reports/?period=week",
            HTTP_AUTHORIZATION=f"Bearer {create_access_token(self.user)}",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["period"]["key"], "week")
        self.assertEqual(payload["reports"]["sales"]["revenueUsd"], 70.0)
        self.assertEqual([item["id"] for item in payload["reports"]["profitInvoices"]], ["inv-week-inside"])

    def test_reports_last_month_period_filters_previous_month(self):
        today = timezone.localdate()
        this_month_start = today.replace(day=1)
        last_month_end = this_month_start - timedelta(days=1)
        last_month_start = last_month_end.replace(day=1)
        inside_day = last_month_start + timedelta(days=min(4, last_month_end.day - 1))
        inside = timezone.make_aware(datetime.combine(inside_day, datetime.min.time()).replace(hour=10))
        outside = timezone.make_aware(datetime.combine(this_month_start, datetime.min.time()).replace(hour=10))
        self.create_profit_invoice_row("inv-last-month-inside", inside, revenue="85.00", cogs="25.00")
        self.create_profit_invoice_row("inv-last-month-outside", outside, revenue="200.00", cogs="50.00")

        response = self.client.get(
            "/api/analytics/reports/?period=last_month",
            HTTP_AUTHORIZATION=f"Bearer {create_access_token(self.user)}",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["period"]["key"], "last_month")
        self.assertEqual(payload["reports"]["sales"]["revenueUsd"], 85.0)
        self.assertEqual([item["id"] for item in payload["reports"]["profitInvoices"]], ["inv-last-month-inside"])

    def test_reports_product_profit_separates_products(self):
        current_year = timezone.localdate().year
        created_at = timezone.make_aware(datetime(current_year, 5, 5, 10, 0))
        second_product = Product.objects.create(
            external_id="prod-second-profit",
            warehouse=self.warehouse,
            name="Second Profit Product",
            stock_quantity=Decimal("10.0000"),
            stock_unit_name="piece",
            stock_unit_multiplier=Decimal("1.0000"),
            purchase_cost_usd=Decimal("50.0000"),
        )
        second_unit = ProductUnit.objects.create(
            external_id="unit-second-profit",
            product=second_product,
            name="piece",
            multiplier=Decimal("1.0000"),
            price_usd=Decimal("80.0000"),
        )
        self.create_profit_invoice_row("inv-product-profit-main", created_at, revenue="100.00", cogs="25.00")
        self.create_profit_invoice_row("inv-product-profit-second", created_at, product=second_product, unit=second_unit, revenue="80.00", cogs="50.00")

        response = self.client.get(
            "/api/analytics/reports/?period=year",
            HTTP_AUTHORIZATION=f"Bearer {create_access_token(self.user)}",
        )

        self.assertEqual(response.status_code, 200)
        rows = {item["id"]: item for item in response.json()["reports"]["profitProducts"]}
        self.assertEqual(rows[self.product.external_id]["grossProfitUsd"], 75.0)
        self.assertEqual(rows[second_product.external_id]["grossProfitUsd"], 30.0)
        self.assertEqual(rows[self.product.external_id]["revenueUsd"], 100.0)
        self.assertEqual(rows[second_product.external_id]["cogsUsd"], 50.0)

    def test_analytics_revision_changes_after_invoice(self):
        before = analytics_revision()

        response = self.client.post(
            "/api/invoices/",
            data={
                "id": "inv-revision",
                "customerName": "Revision Customer",
                "subtotalUsd": "100.00",
                "totalUsd": "100.00",
                "paidUsd": "100.00",
                "items": [self.invoice_item()],
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertNotEqual(before, analytics_revision())

    def test_live_reports_stream_sends_initial_event(self):
        self.client.force_login(self.user)
        response = self.client.get(
            "/api/analytics/reports/live/?once=1",
        )

        self.assertEqual(response.status_code, 200)
        self.assertIn("text/event-stream", response["Content-Type"])
        body = b"".join(response.streaming_content).decode("utf-8")
        self.assertIn("event: reports", body)
        self.assertIn('"revision"', body)

    def test_state_payload_keeps_coffee_theme_and_product_display_fields(self):
        self.product.name = "Orange"
        self.product.brand = "Egyptian"
        self.product.save(update_fields=["name", "brand", "updated_at"])
        AppSnapshot.objects.create(key="default", data={"theme": "coffee", "lang": "ar"})

        invoice = Invoice.objects.create(
            external_id="inv-display",
            subtotal_usd=Decimal("10.0000"),
            total_usd=Decimal("10.0000"),
            remaining_usd=Decimal("10.0000"),
        )
        InvoiceItem.objects.create(
            invoice=invoice,
            product=self.product,
            warehouse=self.warehouse,
            unit_id=self.unit.external_id,
            unit_name="half kilo",
            quantity=Decimal("1.0000"),
            qty_in_base=Decimal("1.0000"),
            price_usd=Decimal("10.0000"),
            total_usd=Decimal("10.0000"),
        )
        supplier = Supplier.objects.create(external_id="sup-display", name="Display Supplier")
        purchase = Purchase.objects.create(
            external_id="pur-display",
            supplier=supplier,
            cost_usd=Decimal("10.0000"),
            remaining_usd=Decimal("10.0000"),
        )
        PurchaseItem.objects.create(
            purchase=purchase,
            product=self.product,
            warehouse=self.warehouse,
            unit_id=self.unit.external_id,
            unit_name="half kilo",
            quantity=Decimal("1.0000"),
            qty_in_base=Decimal("1.0000"),
            unit_cost_usd=Decimal("10.0000"),
            total_usd=Decimal("10.0000"),
        )

        response = self.client.get("/api/state/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["theme"], "coffee")
        invoice_line = next(item for item in payload["invoices"] if item["id"] == "inv-display")["items"][0]
        purchase_line = next(item for item in payload["purchases"] if item["id"] == "pur-display")["items"][0]
        for line in (invoice_line, purchase_line):
            self.assertEqual(line["productName"], "Orange")
            self.assertEqual(line["productBrand"], "Egyptian")
            self.assertEqual(line["warehouseName"], "Test Warehouse")
            self.assertEqual(line["productId"], "prod-test")
        self.assertEqual(payload["warehouses"][0]["color"], "#d6b35a")

    def test_state_payload_keeps_extended_settings_console_fields(self):
        AppSnapshot.objects.create(
            key="default",
            data={
                "theme": "neon-blue",
                "lang": "ar",
                "businessName": "Max Store",
                "businessOwnerName": "Ali Owner",
                "businessCompanyName": "Max Company",
                "businessPhone": "07800000000",
                "businessAddress": "Baghdad",
                "invoicePrintSettings": {
                    "defaultTemplate": "professional-color",
                    "paperSize": "a4",
                    "accentColor": "#2563eb",
                    "perDocumentType": {
                        "directSale": {"template": "thermal-80", "paperSize": "thermal-80", "density": "compact"}
                    },
                },
            },
        )

        response = self.client.get("/api/state/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["theme"], "neon-blue")
        self.assertEqual(payload["businessOwnerName"], "Ali Owner")
        self.assertEqual(payload["businessCompanyName"], "Max Company")
        self.assertEqual(payload["businessPhone"], "07800000000")
        self.assertEqual(payload["businessAddress"], "Baghdad")
        self.assertEqual(payload["invoicePrintSettings"]["defaultTemplate"], "professional-color")
        self.assertEqual(payload["invoicePrintSettings"]["perDocumentType"]["directSale"]["template"], "thermal-80")

    def test_state_payload_accepts_new_theme_ids(self):
        for theme in ["emerald-ledger", "graphite-lime", "ruby-slate", "amethyst-control", "violet-night"]:
            with self.subTest(theme=theme):
                AppSnapshot.objects.update_or_create(key="default", defaults={"data": {"theme": theme}})
                response = self.client.get("/api/state/")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["theme"], theme)

    def test_sync_persists_new_theme_id_without_fallback(self):
        payload = self.sync_payload(theme="violet-night")

        response = self.client.post("/api/sync/", data=payload, content_type="application/json")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["theme"], "violet-night")
        self.assertEqual(AppSnapshot.objects.get(key="default").data["theme"], "violet-night")

    def test_sync_persists_business_profile_and_empty_fields(self):
        AppSnapshot.objects.update_or_create(
            key="default",
            defaults={
                "data": {
                    "businessName": "Old Store",
                    "businessPhone": "07800000000",
                    "businessAddress": "Old Address",
                    "businessOwnerName": "Old Owner",
                    "businessCompanyName": "Old Company",
                }
            },
        )
        payload = self.sync_payload(
            businessName="New Store",
            businessSubtitle="",
            businessPhone="",
            businessAddress="",
            businessOwnerName="Ali Owner",
            businessCompanyName="",
        )

        response = self.client.post("/api/sync/", data=payload, content_type="application/json")

        self.assertEqual(response.status_code, 200)
        snapshot = AppSnapshot.objects.get(key="default").data
        self.assertEqual(snapshot["businessName"], "New Store")
        self.assertEqual(snapshot["businessPhone"], "")
        self.assertEqual(snapshot["businessAddress"], "")
        self.assertEqual(snapshot["businessOwnerName"], "Ali Owner")
        self.assertEqual(snapshot["businessCompanyName"], "")

        state_response = self.client.get("/api/state/")
        self.assertEqual(state_response.status_code, 200)
        state_payload = state_response.json()
        self.assertEqual(state_payload["businessName"], "New Store")
        self.assertEqual(state_payload["businessPhone"], "")
        self.assertEqual(state_payload["businessAddress"], "")
        self.assertEqual(state_payload["businessOwnerName"], "Ali Owner")
        self.assertEqual(state_payload["businessCompanyName"], "")

    def test_invoice_filters_search_status_debt_and_warehouse(self):
        customer = Client.objects.create(external_id="cust-filter", name="Filter Customer")
        invoice = Invoice.objects.create(
            external_id="inv-filter",
            client=customer,
            customer_name=customer.name,
            subtotal_usd=Decimal("100.0000"),
            total_usd=Decimal("100.0000"),
            paid_usd=Decimal("40.0000"),
            remaining_usd=Decimal("60.0000"),
            payment_status="partial",
        )
        InvoiceItem.objects.create(
            invoice=invoice,
            product=self.product,
            warehouse=self.warehouse,
            unit_id=self.unit.external_id,
            unit_name=self.unit.name,
            quantity=Decimal("1.0000"),
            qty_in_base=Decimal("1.0000"),
            price_usd=Decimal("100.0000"),
            total_usd=Decimal("100.0000"),
        )

        response = self.client.get(
            "/api/invoices/",
            {
                "q": "Filter Customer",
                "customerId": customer.external_id,
                "warehouseId": self.warehouse.external_id,
                "paymentStatus": "partial",
                "hasDebt": "true",
                "minTotal": "90",
                "maxTotal": "110",
            },
        )

        self.assertEqual(response.status_code, 200)
        ids = [item["id"] for item in response.json()["invoices"]]
        self.assertIn("inv-filter", ids)

    def test_invoice_search_uses_exact_barcode_before_text_matching(self):
        fanta = Product.objects.create(
            external_id="prod-fanta",
            warehouse=self.warehouse,
            name="فانتا",
            barcode="90",
            stock_quantity=Decimal("100.0000"),
        )
        moisturizer = Product.objects.create(
            external_id="prod-moisturizer",
            warehouse=self.warehouse,
            name="تيري مرطب",
            barcode="929290",
            stock_quantity=Decimal("100.0000"),
        )
        ProductUnit.objects.create(external_id="unit-fanta", product=fanta, name="piece", multiplier=Decimal("1"), price_usd=Decimal("1"))
        ProductUnit.objects.create(external_id="unit-moisturizer", product=moisturizer, name="piece", multiplier=Decimal("1"), price_usd=Decimal("1"))
        fanta_invoice = Invoice.objects.create(external_id="inv-fanta", total_usd=Decimal("1"), paid_usd=Decimal("1"), payment_status="paid")
        moisturizer_invoice = Invoice.objects.create(external_id="inv-moisturizer", total_usd=Decimal("1"), paid_usd=Decimal("1"), payment_status="paid")
        InvoiceItem.objects.create(invoice=fanta_invoice, product=fanta, warehouse=self.warehouse, unit_id="unit-fanta", unit_name="piece", quantity=1, qty_in_base=1, price_usd=1, total_usd=1)
        InvoiceItem.objects.create(invoice=moisturizer_invoice, product=moisturizer, warehouse=self.warehouse, unit_id="unit-moisturizer", unit_name="piece", quantity=1, qty_in_base=1, price_usd=1, total_usd=1)

        barcode_90 = self.client.get("/api/invoices/", {"q": "90"}).json()["invoices"]
        barcode_929290 = self.client.get("/api/invoices/", {"q": "929290"}).json()["invoices"]
        name_search = self.client.get("/api/invoices/", {"q": "فانتا"}).json()["invoices"]

        self.assertEqual([item["id"] for item in barcode_90], ["inv-fanta"])
        self.assertEqual([item["id"] for item in barcode_929290], ["inv-moisturizer"])
        self.assertIn("inv-fanta", [item["id"] for item in name_search])

    def test_purchase_filters_search_supplier_debt_and_warehouse(self):
        supplier = Supplier.objects.create(external_id="sup-filter", name="Filter Supplier")
        purchase = Purchase.objects.create(
            external_id="pur-filter",
            supplier=supplier,
            supplier_name=supplier.name,
            cost_usd=Decimal("80.0000"),
            paid_usd=Decimal("10.0000"),
            remaining_usd=Decimal("70.0000"),
            payment_status="partial",
        )
        PurchaseItem.objects.create(
            purchase=purchase,
            product=self.product,
            warehouse=self.warehouse,
            unit_id=self.unit.external_id,
            unit_name=self.unit.name,
            quantity=Decimal("1.0000"),
            qty_in_base=Decimal("1.0000"),
            unit_cost_usd=Decimal("80.0000"),
            total_usd=Decimal("80.0000"),
        )

        response = self.client.get(
            "/api/purchases-ledger/",
            {
                "q": "Filter Supplier",
                "supplierId": supplier.external_id,
                "warehouseId": self.warehouse.external_id,
                "paymentStatus": "partial",
                "hasDebt": "true",
                "minTotal": "70",
                "maxTotal": "90",
            },
        )

        self.assertEqual(response.status_code, 200)
        ids = [item["id"] for item in response.json()["purchases"]]
        self.assertIn("pur-filter", ids)

    def test_product_image_is_saved_and_returned(self):
        image = "data:image/jpeg;base64,abc123"

        response = self.client.post(
            "/api/products/",
            data={
                "id": "prod-image",
                "name": "Image Product",
                "warehouseId": self.warehouse.external_id,
                "baseUnit": "piece",
                "purchaseCostUsd": "2.00",
                "image": image,
                "units": [
                    {
                        "id": "prod-image-unit",
                        "name": "piece",
                        "multiplier": "1",
                        "priceUsd": "5",
                    }
                ],
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["image"], image)
        self.assertEqual(Product.objects.get(external_id="prod-image").image, image)

    def test_product_image_can_be_updated_and_cleared(self):
        updated_image = "data:image/webp;base64,updated123"
        unit_payload = {
            "id": self.unit.external_id,
            "name": self.unit.name,
            "multiplier": str(self.unit.multiplier),
            "priceUsd": str(self.unit.price_usd),
            "barcode": self.unit.barcode,
        }

        response = self.client.patch(
            f"/api/products/{self.product.external_id}/",
            data={"image": updated_image, "units": [unit_payload]},
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["image"], updated_image)
        self.assertEqual(response.json()["imageUrl"], updated_image)
        self.product.refresh_from_db()
        self.assertEqual(self.product.image, updated_image)

        response = self.client.patch(
            f"/api/products/{self.product.external_id}/",
            data={"imageUrl": "", "units": [unit_payload]},
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["image"], "")
        self.assertEqual(response.json()["imageUrl"], "")
        self.product.refresh_from_db()
        self.assertEqual(self.product.image, "")

    def test_product_images_can_be_uploaded_reordered_and_set_primary(self):
        with TemporaryDirectory() as directory:
            with override_settings(MEDIA_ROOT=Path(directory)):
                first = SimpleUploadedFile("first.webp", b"first-image", content_type="image/webp")
                second = SimpleUploadedFile("second.webp", b"second-image", content_type="image/webp")

                response = self.client.post(
                    f"/api/products/{self.product.external_id}/images/",
                    data={"image": [first, second]},
                )

                self.assertEqual(response.status_code, 201, response.content)
                body = response.json()
                self.assertEqual(len(body["images"]), 2)
                self.assertEqual(body["images"][0]["isPrimary"], True)
                self.assertTrue(body["product"]["imageUrl"].startswith("/media/product-images/"))

                image_ids = [item["id"] for item in body["images"]]
                reorder = self.client.patch(
                    f"/api/products/{self.product.external_id}/images/",
                    data=json.dumps({
                        "primaryImageId": image_ids[1],
                        "images": [
                            {"id": image_ids[1], "sortOrder": 0, "isPrimary": True},
                            {"id": image_ids[0], "sortOrder": 1},
                        ],
                    }),
                    content_type="application/json",
                )

                self.assertEqual(reorder.status_code, 200, reorder.content)
                reordered = reorder.json()["images"]
                self.assertEqual(reordered[0]["id"], image_ids[1])
                self.assertTrue(ProductImage.objects.get(external_id=image_ids[1]).is_primary)

    def test_product_image_delete_promotes_next_primary(self):
        with TemporaryDirectory() as directory:
            with override_settings(MEDIA_ROOT=Path(directory)):
                first = SimpleUploadedFile("first.webp", b"first-image", content_type="image/webp")
                second = SimpleUploadedFile("second.webp", b"second-image", content_type="image/webp")
                response = self.client.post(
                    f"/api/products/{self.product.external_id}/images/",
                    data={"image": [first, second]},
                )
                self.assertEqual(response.status_code, 201, response.content)
                image_ids = [item["id"] for item in response.json()["images"]]

                deleted = self.client.delete(f"/api/products/{self.product.external_id}/images/{image_ids[0]}/")

                self.assertEqual(deleted.status_code, 200, deleted.content)
                remaining = deleted.json()["images"]
                self.assertEqual(len(remaining), 1)
                self.assertEqual(remaining[0]["id"], image_ids[1])
                self.assertTrue(remaining[0]["isPrimary"])

    def test_product_origin_country_is_saved_returned_and_cleared(self):
        response = self.client.post(
            "/api/products/",
            data={
                "id": "prod-origin",
                "name": "Origin Product",
                "warehouseId": self.warehouse.external_id,
                "baseUnit": "piece",
                "originCountry": "تركيا",
                "purchaseCostUsd": "2.00",
                "units": [
                    {
                        "id": "prod-origin-unit",
                        "name": "piece",
                        "multiplier": "1",
                        "priceUsd": "5",
                    }
                ],
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["originCountry"], "تركيا")
        self.assertEqual(response.json()["origin"], "تركيا")
        self.assertEqual(Product.objects.get(external_id="prod-origin").origin_country, "تركيا")

        unit_payload = {
            "id": self.unit.external_id,
            "name": self.unit.name,
            "multiplier": str(self.unit.multiplier),
            "priceUsd": str(self.unit.price_usd),
            "barcode": self.unit.barcode,
        }
        response = self.client.patch(
            f"/api/products/{self.product.external_id}/",
            data={"origin": "الصين", "units": [unit_payload]},
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["originCountry"], "الصين")
        self.product.refresh_from_db()
        self.assertEqual(self.product.origin_country, "الصين")

        response = self.client.patch(
            f"/api/products/{self.product.external_id}/",
            data={"originCountry": "", "units": [unit_payload]},
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["originCountry"], "")
        self.product.refresh_from_db()
        self.assertEqual(self.product.origin_country, "")

    def test_product_create_requires_purchase_cost(self):
        response = self.client.post(
            "/api/products/",
            data={
                "id": "prod-no-cost",
                "name": "No Cost Product",
                "warehouseId": self.warehouse.external_id,
                "baseUnit": "piece",
                "units": [{"id": "prod-no-cost-unit", "name": "piece", "multiplier": "1", "priceUsd": "5"}],
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["reason"], "VALIDATION_ERROR")
        self.assertIn("PURCHASE_COST_REQUIRED", response.json()["message"])
        self.assertFalse(Product.objects.filter(external_id="prod-no-cost").exists())

    def test_product_create_with_opening_stock_creates_fifo_batch(self):
        response = self.client.post(
            "/api/products/",
            data={
                "id": "prod-opening-cost",
                "name": "Opening Cost Product",
                "warehouseId": self.warehouse.external_id,
                "baseUnit": "piece",
                "stockQuantity": "3",
                "purchaseCostUsd": "4.25",
                "units": [{"id": "prod-opening-cost-unit", "name": "piece", "multiplier": "1", "priceUsd": "6"}],
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201)
        product = Product.objects.get(external_id="prod-opening-cost")
        batch = StockBatch.objects.get(product=product)
        self.assertEqual(product.purchase_cost_usd, Decimal("4.2500"))
        self.assertEqual(batch.quantity, Decimal("3.0000"))
        self.assertEqual(batch.purchase_cost_usd, Decimal("4.2500"))
        self.assertEqual(batch.batch_code, "OPENING-prod-opening-cost")

    def test_fifo_sale_uses_oldest_purchase_batch_for_profit(self):
        product = Product.objects.create(
            external_id="prod-fifo",
            warehouse=self.warehouse,
            name="FIFO Cake Carton",
            stock_quantity=Decimal("0.0000"),
            stock_unit_name="carton",
            stock_unit_multiplier=Decimal("1.0000"),
            purchase_cost_usd=Decimal("4.0000"),
        )
        unit = ProductUnit.objects.create(
            external_id="unit-fifo-carton",
            product=product,
            name="carton",
            multiplier=Decimal("1.0000"),
            price_usd=Decimal("5.0000"),
        )
        line = {
            "productId": product.external_id,
            "warehouseId": self.warehouse.external_id,
            "unitId": unit.external_id,
            "unitName": unit.name,
            "quantity": "1",
            "qtyInBase": "1",
        }
        first_purchase = self.client.post(
            "/api/purchases-ledger/",
            data={"id": "pur-fifo-1", "paidUsd": "4.00", "items": [{**line, "unitCostUsd": "4.00", "totalUsd": "4.00"}]},
            content_type="application/json",
        )
        second_purchase = self.client.post(
            "/api/purchases-ledger/",
            data={"id": "pur-fifo-2", "paidUsd": "4.50", "items": [{**line, "unitCostUsd": "4.50", "totalUsd": "4.50"}]},
            content_type="application/json",
        )
        self.assertEqual(first_purchase.status_code, 201)
        self.assertEqual(second_purchase.status_code, 201)

        sale_response = self.client.post(
            "/api/invoices/",
            data={
                "id": "inv-fifo",
                "customerName": "Walk in",
                "subtotalUsd": "5.00",
                "totalUsd": "5.00",
                "paidUsd": "5.00",
                "items": [{
                    "productId": product.external_id,
                    "warehouseId": self.warehouse.external_id,
                    "unitId": unit.external_id,
                    "unitName": unit.name,
                    "qty": "1",
                    "qtyInBase": "1",
                    "priceUsd": "5.00",
                    "totalUsd": "5.00",
                }],
            },
            content_type="application/json",
        )

        self.assertEqual(sale_response.status_code, 201)
        item = InvoiceItem.objects.get(invoice__external_id="inv-fifo")
        self.assertEqual(item.total_cost_usd, Decimal("4.0000"))
        self.assertEqual(item.gross_profit_usd, Decimal("1.0000"))
        self.assertEqual(item.cost_status, "ok")
        self.assertEqual(StockBatch.objects.get(batch_code="pur-fifo-1-1").quantity, Decimal("0.0000"))
        self.assertEqual(StockBatch.objects.get(batch_code="pur-fifo-2-1").quantity, Decimal("1.0000"))

    def test_fefo_sale_uses_earliest_expiring_purchase_batch_for_profit(self):
        product = Product.objects.create(
            external_id="prod-fefo",
            warehouse=self.warehouse,
            name="FEFO Medicine",
            stock_quantity=Decimal("0.0000"),
            stock_unit_name="box",
            stock_unit_multiplier=Decimal("1.0000"),
            purchase_cost_usd=Decimal("4.0000"),
        )
        unit = ProductUnit.objects.create(
            external_id="unit-fefo-box",
            product=product,
            name="box",
            multiplier=Decimal("1.0000"),
            price_usd=Decimal("6.0000"),
        )
        line = {
            "productId": product.external_id,
            "warehouseId": self.warehouse.external_id,
            "unitId": unit.external_id,
            "unitName": unit.name,
            "quantity": "1",
            "qtyInBase": "1",
        }
        first_purchase = self.client.post(
            "/api/purchases-ledger/",
            data={"id": "pur-fefo-1", "paidUsd": "4.00", "items": [{**line, "unitCostUsd": "4.00", "totalUsd": "4.00", "expiresAt": "2026-12-31T12:00:00Z"}]},
            content_type="application/json",
        )
        second_purchase = self.client.post(
            "/api/purchases-ledger/",
            data={"id": "pur-fefo-2", "paidUsd": "4.50", "items": [{**line, "unitCostUsd": "4.50", "totalUsd": "4.50", "expiresAt": "2026-06-30T12:00:00Z"}]},
            content_type="application/json",
        )
        self.assertEqual(first_purchase.status_code, 201)
        self.assertEqual(second_purchase.status_code, 201)

        sale_response = self.client.post(
            "/api/invoices/",
            data={
                "id": "inv-fefo",
                "customerName": "Walk in",
                "subtotalUsd": "6.00",
                "totalUsd": "6.00",
                "paidUsd": "6.00",
                "items": [{
                    "productId": product.external_id,
                    "warehouseId": self.warehouse.external_id,
                    "unitId": unit.external_id,
                    "unitName": unit.name,
                    "qty": "1",
                    "qtyInBase": "1",
                    "priceUsd": "6.00",
                    "totalUsd": "6.00",
                }],
            },
            content_type="application/json",
        )

        self.assertEqual(sale_response.status_code, 201)
        item = InvoiceItem.objects.get(invoice__external_id="inv-fefo")
        self.assertEqual(item.total_cost_usd, Decimal("4.5000"))
        self.assertEqual(item.gross_profit_usd, Decimal("1.5000"))
        self.assertEqual(StockBatch.objects.get(batch_code="pur-fefo-1-1").quantity, Decimal("1.0000"))
        self.assertEqual(StockBatch.objects.get(batch_code="pur-fefo-2-1").quantity, Decimal("0.0000"))

    def test_purchase_landed_cost_updates_batch_storage_cost(self):
        product = Product.objects.create(
            external_id="prod-landed",
            warehouse=self.warehouse,
            name="Landed Carton",
            base_unit="piece",
            stock_quantity=Decimal("0.0000"),
            stock_unit_name="carton",
            stock_unit_multiplier=Decimal("24.0000"),
            purchase_cost_usd=Decimal("20.0000"),
        )
        unit = ProductUnit.objects.create(
            external_id="unit-landed-carton",
            product=product,
            name="carton",
            multiplier=Decimal("24.0000"),
            price_usd=Decimal("32.0000"),
        )

        response = self.client.post(
            "/api/purchases-ledger/",
            data={
                "id": "pur-landed",
                "paidUsd": "26.00",
                "items": [{
                    "productId": product.external_id,
                    "warehouseId": self.warehouse.external_id,
                    "unitId": unit.external_id,
                    "unitName": unit.name,
                    "quantity": "1",
                    "qtyInBase": "24",
                    "supplierUnitCostUsd": "24.00",
                    "unitCostUsd": "26.00",
                    "totalUsd": "26.00",
                    "baseUnitCostUsd": "1.0833",
                    "storageUnitCostUsd": "26.00",
                    "landedCostShareUsd": "2.00",
                    "discountShareUsd": "0.00",
                    "batchCode": "LOT-LANDED-1",
                }],
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201)
        item = PurchaseItem.objects.get(purchase__external_id="pur-landed")
        batch = StockBatch.objects.get(batch_code="LOT-LANDED-1")
        product.refresh_from_db()
        self.assertEqual(item.supplier_unit_cost_usd, Decimal("24.0000"))
        self.assertEqual(item.landed_cost_share_usd, Decimal("2.0000"))
        self.assertEqual(item.base_unit_cost_usd, Decimal("1.0833"))
        self.assertEqual(batch.quantity, Decimal("1.0000"))
        self.assertEqual(batch.purchase_cost_usd, Decimal("26.0000"))
        self.assertEqual(product.purchase_cost_usd, Decimal("26.0000"))

    def test_partial_carton_sale_calculates_proportional_fifo_cost(self):
        product = Product.objects.create(
            external_id="prod-partial-carton",
            warehouse=self.warehouse,
            name="Partial Carton",
            base_unit="piece",
            stock_quantity=Decimal("1.0000"),
            stock_unit_name="carton",
            stock_unit_multiplier=Decimal("12.0000"),
            purchase_cost_usd=Decimal("12.0000"),
        )
        unit = ProductUnit.objects.create(
            external_id="unit-partial-piece",
            product=product,
            name="piece",
            multiplier=Decimal("1.0000"),
            price_usd=Decimal("1.5000"),
        )
        StockBatch.objects.create(
            product=product,
            warehouse=self.warehouse,
            batch_code="OPENING-prod-partial-carton",
            quantity=Decimal("1.0000"),
            purchase_cost_usd=Decimal("12.0000"),
        )

        response = self.client.post(
            "/api/invoices/",
            data={
                "id": "inv-partial-carton",
                "customerName": "Walk in",
                "subtotalUsd": "9.00",
                "totalUsd": "9.00",
                "paidUsd": "9.00",
                "items": [{
                    "productId": product.external_id,
                    "warehouseId": self.warehouse.external_id,
                    "unitId": unit.external_id,
                    "unitName": unit.name,
                    "qty": "6",
                    "qtyInBase": "6",
                    "priceUsd": "1.50",
                    "totalUsd": "9.00",
                }],
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201)
        item = InvoiceItem.objects.get(invoice__external_id="inv-partial-carton")
        self.assertEqual(item.total_cost_usd, Decimal("6.0000"))
        self.assertEqual(item.gross_profit_usd, Decimal("3.0000"))
        product.refresh_from_db()
        self.assertEqual(product.stock_quantity, Decimal("0.5000"))
        self.assertEqual(StockBatch.objects.get(batch_code="OPENING-prod-partial-carton").quantity, Decimal("0.5000"))

    def test_sale_auto_repairs_missing_fifo_batch_from_product_stock(self):
        product = Product.objects.create(
            external_id="prod-auto-cost-batch",
            warehouse=self.warehouse,
            name="Pepsi Carton",
            base_unit="piece",
            stock_quantity=Decimal("98.0000"),
            stock_unit_name="carton",
            stock_unit_multiplier=Decimal("24.0000"),
            purchase_cost_usd=Decimal("5.0000"),
        )
        unit = ProductUnit.objects.create(
            external_id="unit-auto-cost-carton",
            product=product,
            name="carton",
            multiplier=Decimal("24.0000"),
            price_usd=Decimal("6.0000"),
        )
        StockBatch.objects.create(
            product=product,
            warehouse=self.warehouse,
            batch_code="tiny-cost-batch",
            quantity=Decimal("0.0833"),
            purchase_cost_usd=Decimal("5.0000"),
        )

        response = self.client.post(
            "/api/invoices/",
            data={
                "id": "inv-auto-cost-batch",
                "customerName": "Walk in",
                "subtotalUsd": "180.00",
                "totalUsd": "180.00",
                "paidUsd": "180.00",
                "items": [{
                    "productId": product.external_id,
                    "warehouseId": self.warehouse.external_id,
                    "unitId": unit.external_id,
                    "unitName": unit.name,
                    "qty": "30",
                    "qtyInBase": "720",
                    "priceUsd": "6.00",
                    "totalUsd": "180.00",
                }],
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201, response.content)
        item = InvoiceItem.objects.get(invoice__external_id="inv-auto-cost-batch")
        self.assertEqual(item.total_cost_usd, Decimal("150.0000"))
        self.assertEqual(item.gross_profit_usd, Decimal("30.0000"))
        self.assertIn("repaired_from_purchase_cost", {entry.get("source") for entry in item.cost_breakdown})
        product.refresh_from_db()
        self.assertEqual(product.stock_quantity, Decimal("68.0000"))
        open_batch_total = sum(batch.quantity for batch in StockBatch.objects.filter(product=product, is_closed=False))
        self.assertEqual(open_batch_total, Decimal("68.0000"))

    def test_sale_missing_fifo_batch_without_purchase_cost_returns_clear_error(self):
        product = Product.objects.create(
            external_id="prod-missing-purchase-cost",
            warehouse=self.warehouse,
            name="No Cost Product",
            stock_quantity=Decimal("5.0000"),
            stock_unit_name="piece",
            stock_unit_multiplier=Decimal("1.0000"),
            purchase_cost_usd=Decimal("0.0000"),
        )
        unit = ProductUnit.objects.create(
            external_id="unit-missing-purchase-cost",
            product=product,
            name="piece",
            multiplier=Decimal("1.0000"),
            price_usd=Decimal("6.0000"),
        )

        response = self.client.post(
            "/api/invoices/",
            data={
                "id": "inv-missing-purchase-cost",
                "customerName": "Walk in",
                "subtotalUsd": "6.00",
                "totalUsd": "6.00",
                "paidUsd": "6.00",
                "items": [{
                    "productId": product.external_id,
                    "warehouseId": self.warehouse.external_id,
                    "unitId": unit.external_id,
                    "unitName": unit.name,
                    "qty": "1",
                    "qtyInBase": "1",
                    "priceUsd": "6.00",
                    "totalUsd": "6.00",
                }],
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["reason"], "MISSING_PURCHASE_COST")

    def test_sale_keeps_insufficient_stock_when_product_stock_is_short(self):
        product = Product.objects.create(
            external_id="prod-short-stock",
            warehouse=self.warehouse,
            name="Short Stock Product",
            stock_quantity=Decimal("0.5000"),
            stock_unit_name="piece",
            stock_unit_multiplier=Decimal("1.0000"),
            purchase_cost_usd=Decimal("2.0000"),
        )
        unit = ProductUnit.objects.create(
            external_id="unit-short-stock",
            product=product,
            name="piece",
            multiplier=Decimal("1.0000"),
            price_usd=Decimal("6.0000"),
        )
        StockBatch.objects.create(
            product=product,
            warehouse=self.warehouse,
            batch_code="short-stock-batch",
            quantity=Decimal("5.0000"),
            purchase_cost_usd=Decimal("2.0000"),
        )

        response = self.client.post(
            "/api/invoices/",
            data={
                "id": "inv-short-stock",
                "customerName": "Walk in",
                "subtotalUsd": "6.00",
                "totalUsd": "6.00",
                "paidUsd": "6.00",
                "items": [{
                    "productId": product.external_id,
                    "warehouseId": self.warehouse.external_id,
                    "unitId": unit.external_id,
                    "unitName": unit.name,
                    "qty": "1",
                    "qtyInBase": "1",
                    "priceUsd": "6.00",
                    "totalUsd": "6.00",
                }],
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["reason"], "INSUFFICIENT_STOCK")
        self.assertEqual(StockBatch.objects.get(batch_code="short-stock-batch").quantity, Decimal("5.0000"))

    def test_repair_stock_cost_batches_command_creates_missing_batch_once(self):
        product = Product.objects.create(
            external_id="prod-command-cost-batch",
            warehouse=self.warehouse,
            name="Command Cost Batch Product",
            stock_quantity=Decimal("5.0000"),
            stock_unit_name="piece",
            stock_unit_multiplier=Decimal("1.0000"),
            purchase_cost_usd=Decimal("2.0000"),
        )
        StockBatch.objects.create(
            product=product,
            warehouse=self.warehouse,
            batch_code="command-existing-batch",
            quantity=Decimal("1.0000"),
            purchase_cost_usd=Decimal("2.0000"),
        )

        dry_out = io.StringIO()
        call_command("repair_stock_cost_batches", "--dry-run", "--product", product.external_id, stdout=dry_out)
        self.assertIn("repaired 1", dry_out.getvalue())
        self.assertEqual(StockBatch.objects.filter(product=product).count(), 1)

        call_command("repair_stock_cost_batches", "--product", product.external_id, stdout=io.StringIO())
        open_batch_total = sum(batch.quantity for batch in StockBatch.objects.filter(product=product, is_closed=False))
        self.assertEqual(open_batch_total, Decimal("5.0000"))

        second_out = io.StringIO()
        call_command("repair_stock_cost_batches", "--product", product.external_id, stdout=second_out)
        self.assertIn("repaired 0", second_out.getvalue())
        self.assertEqual(StockBatch.objects.filter(product=product).count(), 2)

    def test_system_readiness_flags_commercial_blockers(self):
        no_cost = Product.objects.create(
            external_id="prod-readiness-no-cost",
            warehouse=self.warehouse,
            name="Readiness No Cost",
            stock_quantity=Decimal("3.0000"),
            stock_unit_name="carton",
            stock_unit_multiplier=Decimal("12.0000"),
            purchase_cost_usd=Decimal("0.0000"),
            barcode="READINESS-DUP",
        )
        ProductUnit.objects.create(
            external_id="unit-readiness-no-cost-piece",
            product=no_cost,
            name="piece",
            multiplier=Decimal("1.0000"),
            price_usd=Decimal("1.0000"),
        )
        other = Product.objects.create(
            external_id="prod-readiness-duplicate",
            warehouse=self.warehouse,
            name="Readiness Duplicate",
            stock_quantity=Decimal("0.0000"),
            stock_unit_name="piece",
            stock_unit_multiplier=Decimal("1.0000"),
            purchase_cost_usd=Decimal("1.0000"),
        )
        ProductUnit.objects.create(
            external_id="unit-readiness-duplicate",
            product=other,
            name="piece",
            multiplier=Decimal("1.0000"),
            price_usd=Decimal("1.0000"),
            barcode="READINESS-DUP",
        )

        response = self.client.get(
            "/api/system/readiness/",
            HTTP_AUTHORIZATION=f"Bearer {create_access_token(self.user)}",
        )

        self.assertEqual(response.status_code, 200)
        readiness = response.json()["readiness"]
        codes = {issue["code"] for issue in readiness["issues"]}
        self.assertEqual(readiness["status"], "blocked")
        self.assertIn("missing_purchase_cost", codes)
        self.assertIn("duplicate_barcode", codes)

    def test_system_readiness_reports_missing_fifo_batch_and_inventory_value(self):
        product = Product.objects.create(
            external_id="prod-readiness-batch-gap",
            warehouse=self.warehouse,
            name="Readiness Batch Gap",
            stock_quantity=Decimal("5.0000"),
            stock_unit_name="carton",
            stock_unit_multiplier=Decimal("1.0000"),
            purchase_cost_usd=Decimal("2.0000"),
        )
        ProductUnit.objects.create(
            external_id="unit-readiness-batch-gap",
            product=product,
            name="carton",
            multiplier=Decimal("1.0000"),
            price_usd=Decimal("3.0000"),
        )
        StockBatch.objects.create(
            product=product,
            warehouse=self.warehouse,
            batch_code="readiness-gap-batch",
            quantity=Decimal("1.0000"),
            purchase_cost_usd=Decimal("2.0000"),
        )

        response = self.client.get(
            "/api/analytics/reports/",
            HTTP_AUTHORIZATION=f"Bearer {create_access_token(self.user)}",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        codes = {issue["code"] for issue in payload["readiness"]["issues"]}
        self.assertIn("missing_fifo_batch", codes)
        self.assertGreater(payload["reports"]["products"]["inventoryValueUsd"], 0)

    def test_system_readiness_flags_excess_fifo_batch_and_zero_unit_price(self):
        product = Product.objects.create(
            external_id="prod-readiness-excess-batch",
            warehouse=self.warehouse,
            name="Readiness Excess Batch",
            stock_quantity=Decimal("1.0000"),
            stock_unit_name="carton",
            stock_unit_multiplier=Decimal("1.0000"),
            purchase_cost_usd=Decimal("2.0000"),
        )
        ProductUnit.objects.create(
            external_id="unit-readiness-zero-price",
            product=product,
            name="carton",
            multiplier=Decimal("1.0000"),
            price_usd=Decimal("0.0000"),
        )
        StockBatch.objects.create(
            product=product,
            warehouse=self.warehouse,
            batch_code="readiness-excess-batch",
            quantity=Decimal("5.0000"),
            purchase_cost_usd=Decimal("2.0000"),
        )

        response = self.client.get(
            "/api/system/readiness/",
            HTTP_AUTHORIZATION=f"Bearer {create_access_token(self.user)}",
        )

        self.assertEqual(response.status_code, 200)
        codes = {issue["code"] for issue in response.json()["readiness"]["issues"]}
        self.assertIn("excess_fifo_batch", codes)
        self.assertIn("unit_price_missing", codes)

    def test_product_api_rejects_invalid_stock_unit_multiplier(self):
        response = self.client.post(
            "/api/products/",
            data={
                "id": "prod-invalid-stock-multiplier",
                "name": "Invalid Multiplier Product",
                "warehouseId": self.warehouse.external_id,
                "baseUnit": "piece",
                "stockQuantity": "1",
                "stockUnitMultiplier": "0",
                "purchaseCostUsd": "1",
                "units": [{"id": "unit-invalid-stock-multiplier", "name": "piece", "multiplier": "1", "priceUsd": "2"}],
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["reason"], "VALIDATION_ERROR")
        self.assertIn("STOCK_UNIT_MULTIPLIER_REQUIRED", response.json()["message"])

    def test_product_update_records_accounting_audit_log(self):
        response = self.client.patch(
            f"/api/products/{self.product.external_id}/",
            data={
                "purchaseCostUsd": "30.00",
                "stockUnitName": "carton",
                "stockUnitMultiplier": "12",
                "baseUnit": "piece",
                "barcode": "AUDIT-PRODUCT",
                "units": [
                    {
                        "id": self.unit.external_id,
                        "name": self.unit.name,
                        "multiplier": "1",
                        "priceUsd": "120.00",
                        "priceCurrency": self.unit.price_currency,
                        "barcode": "AUDIT-PIECE",
                    },
                    {
                        "id": "unit-audit-carton",
                        "name": "carton",
                        "multiplier": "12",
                        "priceUsd": "1200.00",
                        "priceCurrency": self.unit.price_currency,
                        "barcode": "AUDIT-CARTON",
                    },
                ],
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200, response.content)
        log = AuditLog.objects.filter(action="product_accounting_change", entity_id=self.product.external_id).first()
        self.assertIsNotNone(log)
        self.assertIn("purchaseCostUsd", log.data["changes"])
        self.assertIn("units", log.data["changes"])

    def test_reports_use_cogs_for_gross_and_net_profit(self):
        response = self.client.post(
            "/api/invoices/",
            data={
                "id": "inv-report-profit",
                "customerName": "Walk in",
                "subtotalUsd": "100.00",
                "totalUsd": "100.00",
                "paidUsd": "100.00",
                "items": [self.invoice_item()],
            },
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 201)

        reports_response = self.client.get(
            "/api/analytics/reports/",
            HTTP_AUTHORIZATION=f"Bearer {create_access_token(self.user)}",
        )

        self.assertEqual(reports_response.status_code, 200)
        reports = reports_response.json()["reports"]
        self.assertEqual(reports["sales"]["revenueUsd"], 100.0)
        self.assertEqual(reports["sales"]["cogsUsd"], 25.0)
        self.assertEqual(reports["sales"]["grossProfitUsd"], 75.0)
        self.assertEqual(reports["sales"]["netProfitUsd"], 75.0)
        self.assertEqual(reports["profitInvoices"][0]["grossProfitUsd"], 75.0)
        accounting_row = next(item for item in reports["productAccounting"] if item["id"] == self.product.external_id)
        self.assertEqual(accounting_row["revenueUsd"], 100.0)
        self.assertEqual(accounting_row["cogsUsd"], 25.0)
        self.assertEqual(accounting_row["grossProfitUsd"], 75.0)
        self.assertEqual(accounting_row["costSource"], "fifo_ok")
        self.assertEqual(accounting_row["inventoryStatus"], "ok")

    def test_trusted_profit_does_not_change_after_product_price_or_cost_changes(self):
        response = self.client.post(
            "/api/invoices/",
            data={
                "id": "inv-profit-lock",
                "customerName": "Walk in",
                "subtotalUsd": "100.00",
                "totalUsd": "100.00",
                "paidUsd": "100.00",
                "items": [self.invoice_item()],
            },
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        item = InvoiceItem.objects.get(invoice__external_id="inv-profit-lock")
        self.assertEqual(item.total_cost_usd, Decimal("25.0000"))
        self.assertEqual(item.gross_profit_usd, Decimal("75.0000"))

        self.product.purchase_cost_usd = Decimal("60.0000")
        self.product.save(update_fields=["purchase_cost_usd", "updated_at"])
        self.unit.price_usd = Decimal("150.0000")
        self.unit.save(update_fields=["price_usd", "updated_at"])

        reports_response = self.client.get(
            "/api/analytics/reports/?period=all",
            HTTP_AUTHORIZATION=f"Bearer {create_access_token(self.user)}",
        )
        self.assertEqual(reports_response.status_code, 200)
        sales = reports_response.json()["reports"]["sales"]
        row = next(entry for entry in reports_response.json()["reports"]["profitInvoices"] if entry["id"] == "inv-profit-lock")
        self.assertEqual(sales["trustedGrossProfitUsd"], 75.0)
        self.assertEqual(row["trustedGrossProfitUsd"], 75.0)
        self.assertEqual(row["costTrustStatus"], "trusted")

    def test_single_direct_pos_product_profit_matches_invoice_and_sales_profit(self):
        self.create_profit_invoice_row(
            "pos-single-product-profit",
            timezone.now(),
            revenue="2400.00",
            cogs="2300.00",
            quantity="1",
            kind="direct_pos",
        )

        response = self.client.get(
            "/api/analytics/reports/?period=all&saleKind=direct_pos",
            HTTP_AUTHORIZATION=f"Bearer {create_access_token(self.user)}",
        )

        self.assertEqual(response.status_code, 200)
        reports = response.json()["reports"]
        product_row = reports["profitProducts"][0]
        invoice_row = reports["profitInvoices"][0]
        self.assertEqual(reports["sales"]["trustedGrossProfitUsd"], 100.0)
        self.assertEqual(invoice_row["trustedGrossProfitUsd"], 100.0)
        self.assertEqual(product_row["trustedGrossProfitUsd"], 100.0)
        self.assertEqual(reports["products"]["trustedGrossProfitUsd"], 100.0)
        self.assertEqual(reports["products"]["soldProductCount"], 1)
        self.assertEqual(product_row["costSource"], "fifo_ok")

    def test_repair_missing_cost_invoice_can_promote_safe_fifo_profit(self):
        self.product.purchase_cost_usd = Decimal("2300.0000")
        self.product.save(update_fields=["purchase_cost_usd", "updated_at"])
        StockBatch.objects.filter(product=self.product).update(purchase_cost_usd=Decimal("2300.0000"))
        created_at = timezone.now()
        self.create_profit_invoice_row(
            "pos-ahmed-fifo-profit",
            created_at,
            revenue="2400.00",
            cogs="2300.00",
            kind="direct_pos",
        )
        self.create_profit_invoice_row(
            "pos-abdulrahman-fifo-profit",
            created_at,
            revenue="2400.00",
            cogs="2300.00",
            kind="direct_pos",
        )
        karar_invoice = Invoice.objects.create(
            external_id="inv-karar-missing-cost",
            customer_name="كرار",
            kind="invoice",
            subtotal_usd=Decimal("2400.0000"),
            total_usd=Decimal("2400.0000"),
            paid_usd=Decimal("2400.0000"),
            payment_status="paid",
            created_at=created_at,
        )
        InvoiceItem.objects.create(
            invoice=karar_invoice,
            product=self.product,
            warehouse=self.warehouse,
            unit_id=self.unit.external_id,
            unit_name=self.unit.name,
            quantity=Decimal("1.0000"),
            qty_in_base=Decimal("1.0000"),
            price_usd=Decimal("2400.0000"),
            total_usd=Decimal("2400.0000"),
            unit_cost_usd=Decimal("0.0000"),
            total_cost_usd=Decimal("0.0000"),
            gross_profit_usd=Decimal("0.0000"),
            cost_status="missing_cost",
            cost_breakdown=[],
        )

        repair_response = self.client.post(
            "/api/invoice-costs/repair/",
            data=json.dumps({}),
            content_type="application/json",
        )

        self.assertEqual(repair_response.status_code, 200, repair_response.content)
        self.assertEqual(repair_response.json()["fifoRepaired"], 1)
        repaired_item = InvoiceItem.objects.get(invoice__external_id="inv-karar-missing-cost")
        self.assertEqual(repaired_item.total_cost_usd, Decimal("2300.0000"))
        self.assertEqual(repaired_item.gross_profit_usd, Decimal("100.0000"))
        self.assertEqual(repaired_item.cost_breakdown[0]["source"], "fifo_ok")

        reports_response = self.client.get(
            "/api/analytics/reports/?period=all",
            HTTP_AUTHORIZATION=f"Bearer {create_access_token(self.user)}",
        )
        self.assertEqual(reports_response.status_code, 200)
        reports = reports_response.json()["reports"]
        self.assertEqual(reports["sales"]["trustedGrossProfitUsd"], 300.0)
        karar_row = next(entry for entry in reports["profitInvoices"] if entry["id"] == "inv-karar-missing-cost")
        self.assertEqual(karar_row["trustedGrossProfitUsd"], 100.0)
        self.assertEqual(karar_row["costTrustStatus"], "trusted")

    def test_sync_missing_line_cost_does_not_zero_existing_backend_cogs(self):
        response = self.client.post(
            "/api/invoices/",
            data={
                "id": "inv-sync-preserve-cost",
                "customerName": "Walk in",
                "subtotalUsd": "100.00",
                "totalUsd": "100.00",
                "paidUsd": "100.00",
                "items": [self.invoice_item()],
            },
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        existing_item = InvoiceItem.objects.get(invoice__external_id="inv-sync-preserve-cost")
        self.assertEqual(existing_item.total_cost_usd, Decimal("25.0000"))

        payload = self.sync_payload(invoices=[{
            "id": "inv-sync-preserve-cost",
            "kind": "invoice",
            "customerName": "Walk in",
            "createdAt": timezone.now().isoformat(),
            "exchangeRate": 1460,
            "subtotalUsd": "100.00",
            "discountUsd": "0.00",
            "totalUsd": "100.00",
            "paidUsd": "100.00",
            "remainingUsd": "0.00",
            "paymentStatus": "paid",
            "items": [self.invoice_item()],
        }])

        sync_response = self.client.post("/api/sync/", data=json.dumps(payload), content_type="application/json")

        self.assertEqual(sync_response.status_code, 200, sync_response.content)
        synced_item = InvoiceItem.objects.get(invoice__external_id="inv-sync-preserve-cost")
        self.assertEqual(synced_item.total_cost_usd, Decimal("25.0000"))
        self.assertEqual(synced_item.gross_profit_usd, Decimal("75.0000"))

    def test_synced_installment_invoice_uses_product_cost_and_splits_profit(self):
        StockBatch.objects.filter(product=self.product).delete()
        self.product.purchase_cost_usd = Decimal("2300.0000")
        self.product.save(update_fields=["purchase_cost_usd", "updated_at"])
        self.unit.price_usd = Decimal("2350.0000")
        self.unit.save(update_fields=["price_usd", "updated_at"])
        customer = Client.objects.create(external_id="client-installment-profit", name="Installment Profit")
        plan = {
            "type": "installment",
            "cashPriceUsd": "2350.00",
            "profitUsd": "200.00",
            "finalPriceUsd": "2550.00",
            "totalUsd": "2550.00",
            "downPaymentUsd": "0.00",
            "remainingUsd": "0.00",
            "profit": {
                "mode": "fixed",
                "fixedAmountUsd": "200.00",
                "cashPriceUsd": "2350.00",
                "profitUsd": "200.00",
                "finalPriceUsd": "2550.00",
            },
            "schedule": [{"number": 1, "amountUsd": "2550.00", "paidUsd": "2550.00", "status": "paid"}],
        }
        payload = {"invoices": [{
            "id": "inv-sync-installment-profit",
            "kind": "installment",
            "clientId": customer.external_id,
            "customerName": customer.name,
            "createdAt": timezone.now().isoformat(),
            "exchangeRate": 1460,
            "subtotalUsd": "2550.00",
            "discountUsd": "0.00",
            "totalUsd": "2550.00",
            "paidUsd": "2550.00",
            "remainingUsd": "0.00",
            "paymentStatus": "paid",
            "installmentPlan": plan,
            "items": [self.invoice_item(price="2550.00", total="2550.00")],
        }]}

        api.sync_invoices(payload)
        synced_item = InvoiceItem.objects.get(invoice__external_id="inv-sync-installment-profit")
        self.assertEqual(synced_item.total_cost_usd, Decimal("2300.0000"))
        self.assertEqual(synced_item.gross_profit_usd, Decimal("250.0000"))
        self.assertEqual(synced_item.cost_breakdown[0]["source"], "estimated_from_product_cost")

        reports_response = self.client.get(
            "/api/analytics/reports/?period=all",
            HTTP_AUTHORIZATION=f"Bearer {create_access_token(self.user)}",
        )
        self.assertEqual(reports_response.status_code, 200)
        row = next(entry for entry in reports_response.json()["reports"]["profitInvoices"] if entry["id"] == "inv-sync-installment-profit")
        self.assertEqual(row["grossProfitUsd"], 250.0)
        self.assertEqual(row["cashSaleProfitUsd"], 50.0)
        self.assertEqual(row["installmentProfitUsd"], 200.0)
        self.assertEqual(row["costSource"], "estimated_from_product_cost")

    def test_reports_separate_fifo_profit_from_estimated_profit_review(self):
        created_at = timezone.now()
        self.create_profit_invoice_row("inv-trusted-profit", created_at, revenue="100.00", cogs="25.00")
        self.create_profit_invoice_row(
            "inv-estimated-profit",
            created_at,
            revenue="100.00",
            cogs="50.00",
            cost_source="estimated_from_product_cost",
        )

        response = self.client.get(
            "/api/analytics/reports/?period=all",
            HTTP_AUTHORIZATION=f"Bearer {create_access_token(self.user)}",
        )
        self.assertEqual(response.status_code, 200)
        reports = response.json()["reports"]
        self.assertEqual(reports["sales"]["grossProfitUsd"], 125.0)
        self.assertEqual(reports["sales"]["trustedGrossProfitUsd"], 125.0)
        self.assertEqual(reports["sales"]["allGrossProfitUsd"], 125.0)
        self.assertEqual(reports["sales"]["estimatedGrossProfitUsd"], 50.0)
        self.assertEqual(reports["sales"]["reviewProfitRowsCount"], 1)
        self.assertEqual(reports["sales"]["costTrustStatus"], "needs_review")
        self.assertEqual(reports["sales"]["profitConfidence"], 100)
        self.assertEqual(reports["sales"]["trustedMarkup"], 167)
        self.assertTrue(reports["sales"]["netProfitReliable"])

        review_response = self.client.get(
            "/api/analytics/reports/?period=all&costSource=review",
            HTTP_AUTHORIZATION=f"Bearer {create_access_token(self.user)}",
        )
        self.assertEqual(review_response.status_code, 200)
        review_rows = review_response.json()["reports"]["profitInvoices"]
        self.assertEqual([item["id"] for item in review_rows], ["inv-estimated-profit"])
        self.assertEqual(review_response.json()["reports"]["sales"]["trustedGrossProfitUsd"], 50.0)
        self.assertEqual(review_response.json()["reports"]["sales"]["estimatedGrossProfitUsd"], 50.0)
        self.assertFalse(review_response.json()["reports"]["sales"]["netProfitReliable"])

        filtered_response = self.client.get(
            "/api/analytics/reports/?period=all&q=trusted",
            HTTP_AUTHORIZATION=f"Bearer {create_access_token(self.user)}",
        )
        self.assertEqual(filtered_response.status_code, 200)
        self.assertFalse(filtered_response.json()["reports"]["sales"]["netProfitReliable"])
        self.assertEqual(filtered_response.json()["reports"]["sales"]["trustedGrossProfitUsd"], 75.0)

    def test_iqd_phone_sale_reports_real_profit_not_full_revenue(self):
        phone = Product.objects.create(
            external_id="prod-iphone-profit",
            warehouse=self.warehouse,
            name="ايفون 17 برو ماكس",
            stock_quantity=Decimal("1.0000"),
            stock_unit_name="piece",
            stock_unit_multiplier=Decimal("1.0000"),
            purchase_cost_usd=Decimal("1164.3836"),
            currency="IQD",
        )
        StockBatch.objects.create(
            product=phone,
            warehouse=self.warehouse,
            batch_code="OPENING-prod-iphone-profit",
            quantity=Decimal("1.0000"),
            purchase_cost_usd=Decimal("1164.3836"),
        )
        unit = ProductUnit.objects.create(
            external_id="unit-iphone-profit",
            product=phone,
            name="piece",
            multiplier=Decimal("1.0000"),
            price_usd=Decimal("1232.8767"),
            price_currency="IQD",
        )

        response = self.client.post(
            "/api/invoices/",
            data={
                "id": "inv-iphone-profit",
                "customerName": "ali",
                "subtotalUsd": "1232.8767",
                "totalUsd": "1232.8767",
                "paidUsd": "1232.8767",
                "items": [{
                    "productId": phone.external_id,
                    "warehouseId": self.warehouse.external_id,
                    "unitId": unit.external_id,
                    "unitName": unit.name,
                    "qty": "1",
                    "qtyInBase": "1",
                    "currency": "IQD",
                    "exchangeRate": "1460",
                    "price": "1800000",
                    "lineTotal": "1800000",
                }],
            },
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 201)

        item = InvoiceItem.objects.get(invoice__external_id="inv-iphone-profit")
        self.assertEqual(item.cost_status, "ok")
        self.assertEqual(item.total_cost_usd, Decimal("1164.3836"))
        self.assertEqual(item.gross_profit_usd, Decimal("68.4931"))

        reports_response = self.client.get(
            "/api/analytics/reports/",
            HTTP_AUTHORIZATION=f"Bearer {create_access_token(self.user)}",
        )
        reports = reports_response.json()["reports"]
        row = next(entry for entry in reports["profitInvoices"] if entry["id"] == "inv-iphone-profit")
        self.assertEqual(row["formattedRevenue"], "1,800,000 د.ع")
        self.assertEqual(row["formattedCogs"], "1,700,000 د.ع")
        self.assertEqual(row["formattedGrossProfit"], "100,000 د.ع")

    def test_sync_missing_local_cost_does_not_overwrite_existing_invoice_cogs(self):
        response = self.client.post(
            "/api/invoices/",
            data={
                "id": "inv-sync-keep-cost",
                "customerName": "Walk in",
                "subtotalUsd": "100.00",
                "totalUsd": "100.00",
                "paidUsd": "100.00",
                "items": [self.invoice_item()],
            },
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 201)
        self.product.purchase_cost_usd = Decimal("30.0000")
        self.product.save(update_fields=["purchase_cost_usd"])

        sync_line = self.invoice_item()
        sync_line.pop("totalCostUsd", None)
        sync_line.pop("unitCostUsd", None)
        sync_line.pop("grossProfitUsd", None)
        sync_response = self.client.post(
            "/api/sync/",
            data=self.sync_payload(invoices=[{
                "id": "inv-sync-keep-cost",
                "customerName": "Walk in",
                "kind": "invoice",
                "subtotalUsd": "100.00",
                "discountUsd": "0.00",
                "totalUsd": "100.00",
                "paidUsd": "100.00",
                "remainingUsd": "0.00",
                "paymentStatus": "paid",
                "items": [sync_line],
            }]),
            content_type="application/json",
        )

        self.assertEqual(sync_response.status_code, 200)
        item = InvoiceItem.objects.get(invoice__external_id="inv-sync-keep-cost")
        self.assertEqual(item.total_cost_usd, Decimal("25.0000"))
        self.assertEqual(item.gross_profit_usd, Decimal("75.0000"))
        self.assertEqual(item.cost_status, "ok")

    def test_sync_missing_local_cost_uses_product_cost_when_fifo_unavailable(self):
        other_warehouse = Warehouse.objects.create(external_id="wh-sync-estimated", name="Sync Estimated Warehouse")
        sync_line = self.invoice_item()
        sync_line["warehouseId"] = other_warehouse.external_id
        sync_line.pop("totalCostUsd", None)
        sync_line.pop("unitCostUsd", None)
        sync_line.pop("grossProfitUsd", None)
        warehouses = [
            {
                "id": self.warehouse.external_id,
                "name": self.warehouse.name,
                "code": self.warehouse.code,
                "zone": "",
                "manager": "",
                "color": self.warehouse.color,
                "note": "",
            },
            {
                "id": other_warehouse.external_id,
                "name": other_warehouse.name,
                "code": other_warehouse.code,
                "zone": "",
                "manager": "",
                "color": other_warehouse.color,
                "note": "",
            },
        ]

        response = self.client.post(
            "/api/sync/",
            data=self.sync_payload(invoices=[{
                "id": "inv-sync-estimated-cost",
                "customerName": "Walk in",
                "kind": "invoice",
                "subtotalUsd": "100.00",
                "discountUsd": "0.00",
                "totalUsd": "100.00",
                "paidUsd": "100.00",
                "remainingUsd": "0.00",
                "paymentStatus": "paid",
                "items": [sync_line],
            }], warehouses=warehouses),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200, response.content)
        item = InvoiceItem.objects.get(invoice__external_id="inv-sync-estimated-cost")
        self.assertEqual(item.total_cost_usd, Decimal("25.0000"))
        self.assertEqual(item.gross_profit_usd, Decimal("75.0000"))
        self.assertEqual(item.cost_status, "ok")
        self.assertEqual(item.cost_breakdown[0]["source"], "estimated_from_product_cost")

    def test_repair_missing_invoice_costs_command_prefers_fifo_batches(self):
        invoice = Invoice.objects.create(
            external_id="inv-repair-cost",
            customer_name="Walk in",
            subtotal_usd=Decimal("100.0000"),
            total_usd=Decimal("100.0000"),
            paid_usd=Decimal("100.0000"),
            payment_status="paid",
        )
        InvoiceItem.objects.create(
            invoice=invoice,
            product=self.product,
            warehouse=self.warehouse,
            unit_id=self.unit.external_id,
            unit_name=self.unit.name,
            quantity=Decimal("1.0000"),
            qty_in_base=Decimal("1.0000"),
            price_usd=Decimal("100.0000"),
            total_usd=Decimal("100.0000"),
            total_cost_usd=Decimal("0.0000"),
            gross_profit_usd=Decimal("0.0000"),
            cost_status="missing_cost",
        )
        out = io.StringIO()

        call_command("repair_missing_invoice_costs", stdout=out)

        item = InvoiceItem.objects.get(invoice=invoice)
        self.assertIn("repaired 1", out.getvalue())
        self.assertEqual(item.unit_cost_usd, Decimal("25.0000"))
        self.assertEqual(item.total_cost_usd, Decimal("25.0000"))
        self.assertEqual(item.gross_profit_usd, Decimal("75.0000"))
        self.assertEqual(item.cost_status, "ok")
        self.assertIn("fifo_ok", {entry.get("source") for entry in item.cost_breakdown})

    def test_repair_missing_invoice_costs_uses_product_cost_when_fifo_warehouse_mismatches(self):
        other_warehouse = Warehouse.objects.create(external_id="wh-other-cost", name="Other Cost Warehouse")
        StockBatch.objects.filter(product=self.product).update(warehouse=other_warehouse)
        invoice = Invoice.objects.create(
            external_id="inv-repair-estimated-cost",
            customer_name="Walk in",
            subtotal_usd=Decimal("100.0000"),
            total_usd=Decimal("100.0000"),
            paid_usd=Decimal("100.0000"),
            payment_status="paid",
        )
        InvoiceItem.objects.create(
            invoice=invoice,
            product=self.product,
            warehouse=self.warehouse,
            unit_id=self.unit.external_id,
            unit_name=self.unit.name,
            quantity=Decimal("1.0000"),
            qty_in_base=Decimal("1.0000"),
            price_usd=Decimal("100.0000"),
            total_usd=Decimal("100.0000"),
            total_cost_usd=Decimal("0.0000"),
            gross_profit_usd=Decimal("0.0000"),
            cost_status="missing_cost",
        )

        call_command("repair_missing_invoice_costs", "--invoice", invoice.external_id, stdout=io.StringIO())

        item = InvoiceItem.objects.get(invoice=invoice)
        self.assertEqual(item.total_cost_usd, Decimal("25.0000"))
        self.assertEqual(item.gross_profit_usd, Decimal("75.0000"))
        self.assertEqual(item.cost_status, "ok")
        self.assertEqual(item.cost_breakdown[0]["source"], "repaired_from_purchase_cost")

    def test_iqd_purchase_then_partial_sale_uses_fifo_cogs_without_fractional_input(self):
        product = Product.objects.create(
            external_id="prod-iqd-cost",
            warehouse=self.warehouse,
            name="IQD Cost Product",
            stock_quantity=Decimal("0.0000"),
            stock_unit_name="piece",
            stock_unit_multiplier=Decimal("1.0000"),
            purchase_cost_usd=Decimal("0.0000"),
        )
        unit = ProductUnit.objects.create(
            external_id="unit-iqd-cost",
            product=product,
            name="piece",
            multiplier=Decimal("1.0000"),
            price_usd=Decimal("2.0000"),
        )

        purchase_response = self.client.post(
            "/api/purchases-ledger/",
            data={
                "id": "pur-iqd-cost",
                "currency": "IQD",
                "exchangeRate": "1460",
                "paidUsd": "2",
                "items": [{
                    "productId": product.external_id,
                    "warehouseId": self.warehouse.external_id,
                    "unitId": unit.external_id,
                    "unitName": unit.name,
                    "quantity": "2",
                    "qtyInBase": "2",
                    "currency": "IQD",
                    "exchangeRate": "1460",
                    "unitCost": "1460",
                    "lineTotal": "2920",
                }],
            },
            content_type="application/json",
        )
        self.assertEqual(purchase_response.status_code, 201)

        sale_response = self.client.post(
            "/api/invoices/",
            data={
                "id": "inv-iqd-cost",
                "customerName": "Walk in",
                "currency": "IQD",
                "exchangeRate": "1460",
                "paidUsd": "2",
                "items": [{
                    "productId": product.external_id,
                    "warehouseId": self.warehouse.external_id,
                    "unitId": unit.external_id,
                    "unitName": unit.name,
                    "qty": "1",
                    "qtyInBase": "1",
                    "currency": "IQD",
                    "exchangeRate": "1460",
                    "price": "2920",
                    "lineTotal": "2920",
                }],
            },
            content_type="application/json",
        )
        self.assertEqual(sale_response.status_code, 201)
        item = InvoiceItem.objects.get(invoice__external_id="inv-iqd-cost")
        self.assertEqual(item.total_cost_usd, Decimal("1.0000"))
        self.assertEqual(item.gross_profit_usd, Decimal("1.0000"))
        self.assertEqual(StockBatch.objects.get(batch_code="pur-iqd-cost-1").quantity, Decimal("1.0000"))

    def test_profit_endpoint_uses_sold_goods_cogs_not_total_purchases(self):
        unsold_purchase = self.client.post(
            "/api/purchases-ledger/",
            data={"id": "pur-unsold-profit", "paidUsd": "25.00", "items": [self.purchase_item()]},
            content_type="application/json",
        )
        self.assertEqual(unsold_purchase.status_code, 201)
        sale_response = self.client.post(
            "/api/invoices/",
            data={
                "id": "inv-profit-endpoint",
                "customerName": "Walk in",
                "subtotalUsd": "100.00",
                "totalUsd": "100.00",
                "paidUsd": "100.00",
                "items": [self.invoice_item()],
            },
            content_type="application/json",
        )
        self.assertEqual(sale_response.status_code, 201)

        profit_response = self.client.get("/api/profit/")

        self.assertEqual(profit_response.status_code, 200)
        payload = profit_response.json()
        self.assertEqual(payload["salesUsd"], 100.0)
        self.assertEqual(payload["cogsUsd"], 25.0)
        self.assertEqual(payload["grossProfitUsd"], 75.0)

    def test_installment_profit_schedule_uses_whole_amounts_and_balances_last_payment(self):
        customer = Client.objects.create(external_id="client-installment-round", name="Installment Client")
        response = self.client.post(
            "/api/installments/",
            data={
                "id": "inv-installment-round",
                "clientId": customer.external_id,
                "customerId": customer.external_id,
                "currency": "USD",
                "installmentCount": 3,
                "downPaymentUsd": "0",
                "profit": {"mode": "fixed", "fixedAmountUsd": "10"},
                "items": [self.invoice_item()],
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201)
        payload = response.json()
        schedule = payload["invoice"]["installmentPlan"]["schedule"]
        amounts = [item["amountUsd"] for item in schedule]
        self.assertEqual(amounts, [37.0, 37.0, 36.0])
        self.assertEqual(sum(amounts), 110.0)
        self.assertEqual(payload["invoice"]["installmentPlan"]["profitUsd"], 10.0)

    def test_void_direct_paid_invoice_reverses_stock_and_keeps_record(self):
        response = self.client.post(
            "/api/invoices/",
            data={
                "id": "inv-void",
                "customerName": "Walk in",
                "subtotalUsd": "100.00",
                "totalUsd": "100.00",
                "paidUsd": "100.00",
                "items": [self.invoice_item()],
            },
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 201)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_quantity, Decimal("999.0000"))
        self.assertEqual(StockBatch.objects.get(batch_code="OPENING-prod-test").quantity, Decimal("999.0000"))

        delete_response = self.client.delete("/api/invoices/inv-void/")

        self.assertEqual(delete_response.status_code, 200)
        invoice = Invoice.objects.get(external_id="inv-void")
        self.assertIsNotNone(invoice.voided_at)
        self.assertEqual(invoice.payment_status, "void")
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_quantity, Decimal("1000.0000"))
        self.assertEqual(StockBatch.objects.get(batch_code="OPENING-prod-test").quantity, Decimal("1000.0000"))
        self.assertEqual(StockMovement.objects.filter(note__icontains="Void invoice inv-void").count(), 1)

    def test_void_invoice_with_debt_is_blocked(self):
        response = self.client.post(
            "/api/invoices/",
            data={
                "id": "inv-debt-void",
                "customerName": "Walk in",
                "subtotalUsd": "100.00",
                "totalUsd": "100.00",
                "paidUsd": "0.00",
                "items": [self.invoice_item()],
            },
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 201)

        delete_response = self.client.delete("/api/invoices/inv-debt-void/")

        self.assertEqual(delete_response.status_code, 400)
        self.assertEqual(delete_response.json()["reason"], "INVOICE_HAS_DEBT")
        invoice = Invoice.objects.get(external_id="inv-debt-void")
        self.assertIsNone(invoice.voided_at)

    def test_sync_permanently_deletes_missing_product_from_payload(self):
        response = self.client.post(
            "/api/sync/",
            data=self.sync_payload(products=[]),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(Product.objects.filter(external_id=self.product.external_id).exists())
        self.assertFalse(ProductUnit.objects.filter(external_id=self.unit.external_id).exists())
        self.assertNotIn("prod-test", [product["id"] for product in response.json()["products"]])

    def test_sync_archives_missing_warehouse_and_permanently_deletes_products(self):
        response = self.client.post(
            "/api/sync/",
            data=self.sync_payload(warehouses=[], products=[]),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.warehouse.refresh_from_db()
        self.assertIsNotNone(self.warehouse.deleted_at)
        self.assertFalse(Product.objects.filter(external_id=self.product.external_id).exists())
        self.assertFalse(ProductUnit.objects.filter(external_id=self.unit.external_id).exists())
        self.assertNotIn("wh-test", [warehouse["id"] for warehouse in response.json()["warehouses"]])
        self.assertNotIn("prod-test", [product["id"] for product in response.json()["products"]])

    def test_sync_archives_missing_customer_and_supplier_without_debt(self):
        customer = Client.objects.create(external_id="cust-delete", name="Customer Delete")
        supplier = Supplier.objects.create(external_id="sup-delete", name="Supplier Delete")

        response = self.client.post(
            "/api/sync/",
            data=self.sync_payload(clients=[], suppliers=[]),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        customer.refresh_from_db()
        supplier.refresh_from_db()
        self.assertIsNotNone(customer.deleted_at)
        self.assertIsNotNone(supplier.deleted_at)
        self.assertNotIn("cust-delete", [client["id"] for client in response.json()["clients"]])
        self.assertNotIn("sup-delete", [supplier_item["id"] for supplier_item in response.json()["suppliers"]])

    def test_sync_saves_warehouse_only_payload(self):
        response = self.client.post(
            "/api/sync/",
            data=self.sync_payload(
                warehouses=[{"id": "wh-only", "name": "Only Warehouse", "code": "OW", "zone": "", "manager": "", "color": "#38bdf8", "note": ""}],
                products=[],
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["syncHasErrors"])
        warehouse = Warehouse.objects.get(external_id="wh-only", deleted_at__isnull=True)
        self.assertEqual(warehouse.color, "#38bdf8")

    def test_warehouse_color_api_create_patch_and_legacy_default(self):
        created = self.client.post(
            "/api/warehouses/",
            data={"id": "wh-color-api", "name": "Color API", "color": "#34d399"},
            content_type="application/json",
        )
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.json()["color"], "#34d399")

        patched = self.client.patch(
            "/api/warehouses/wh-color-api/",
            data={"color": "#f97316"},
            content_type="application/json",
        )
        self.assertEqual(patched.status_code, 200)
        self.assertEqual(patched.json()["color"], "#f97316")

        response = self.client.post(
            "/api/sync/",
            data=self.sync_payload(warehouses=[{"id": "wh-legacy", "name": "Legacy Warehouse"}], products=[]),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["syncHasErrors"])
        self.assertEqual(Warehouse.objects.get(external_id="wh-legacy").color, "#d6b35a")

    def test_sync_saves_client_only_payload(self):
        response = self.client.post(
            "/api/sync/",
            data=self.sync_payload(
                products=[],
                clients=[{"id": "client-only", "name": "Only Client", "phone": "0770", "openingBalanceUsd": "0"}],
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["syncHasErrors"])
        self.assertTrue(Client.objects.filter(external_id="client-only", deleted_at__isnull=True).exists())

    def test_sync_saves_supplier_only_payload(self):
        response = self.client.post(
            "/api/sync/",
            data=self.sync_payload(
                products=[],
                suppliers=[{"id": "supplier-only", "name": "Only Supplier", "phone": "0771", "openingBalanceUsd": "0"}],
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["syncHasErrors"])
        self.assertTrue(Supplier.objects.filter(external_id="supplier-only", deleted_at__isnull=True).exists())

    def test_sync_saves_employee_only_payload(self):
        response = self.client.post(
            "/api/sync/",
            data=self.sync_payload(
                products=[],
                employees=[{"id": "employee-only", "name": "Only Employee", "phone": "0772", "role": "cashier", "salary": "500", "workHours": "8"}],
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["syncHasErrors"])
        employee = Employee.objects.get(external_id="employee-only", deleted_at__isnull=True)
        self.assertEqual(employee.name, "Only Employee")
        self.assertEqual(employee.salary, Decimal("500"))

    def test_sync_saves_valid_product_with_units(self):
        response = self.client.post(
            "/api/sync/",
            data=self.sync_payload(
                products=[
                    {
                        "id": "product-valid",
                        "name": "Valid Product",
                        "warehouseId": self.warehouse.external_id,
                        "baseUnit": "piece",
                        "stockQuantity": "12",
                        "units": [
                            {"id": "product-valid-piece", "name": "piece", "multiplier": "1", "priceUsd": "2", "barcode": "PV-1"},
                            {"id": "product-valid-box", "name": "box", "multiplier": "6", "priceUsd": "10", "barcode": "PV-6"},
                        ],
                    }
                ],
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["syncHasErrors"])
        product = Product.objects.get(external_id="product-valid", deleted_at__isnull=True)
        self.assertEqual(product.units.filter(deleted_at__isnull=True).count(), 2)

    def test_sync_saves_product_origin_country(self):
        response = self.client.post(
            "/api/sync/",
            data=self.sync_payload(
                products=[
                    {
                        "id": "product-origin-sync",
                        "name": "Origin Sync Product",
                        "warehouseId": self.warehouse.external_id,
                        "originCountry": "العراق",
                        "baseUnit": "piece",
                        "units": [
                            {"id": "product-origin-sync-piece", "name": "piece", "multiplier": "1", "priceUsd": "2"},
                        ],
                    }
                ],
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["syncHasErrors"])
        product = Product.objects.get(external_id="product-origin-sync", deleted_at__isnull=True)
        self.assertEqual(product.origin_country, "العراق")
        payload_product = next(item for item in response.json()["products"] if item["id"] == "product-origin-sync")
        self.assertEqual(payload_product["originCountry"], "العراق")
        self.assertEqual(payload_product["origin"], "العراق")

    def test_sync_saves_origin_country_presets(self):
        origin_presets = [
            {"id": "origin-iq", "name": "عراقي", "color": "#22c55e"},
            {"id": "origin-tr", "name": "تركي", "color": "#ef4444"},
        ]
        response = self.client.post(
            "/api/sync/",
            data=self.sync_payload(originCountries=origin_presets),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["syncHasErrors"])
        self.assertEqual(response.json()["originCountries"], origin_presets)
        snapshot = AppSnapshot.objects.get(key="default").data
        self.assertEqual(snapshot["originCountries"], origin_presets)

        state_response = self.client.get("/api/state/")
        self.assertEqual(state_response.status_code, 200)
        self.assertEqual(state_response.json()["originCountries"], origin_presets)

    def test_health_exposes_backend_code_fingerprint(self):
        response = self.client.get("/api/health/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["codeFingerprint"])
        self.assertIn("version", payload)

    def test_system_health_reports_ready_core_checks(self):
        AppSnapshot.objects.update_or_create(
            key="default",
            defaults={
                "data": {
                    "dataGeneration": "reset-test",
                    "warehouses": [],
                    "products": [],
                    "clients": [],
                    "suppliers": [],
                    "employees": [],
                    "invoices": [],
                    "purchases": [],
                    "cashVouchers": [],
                }
            },
        )

        response = self.client.get("/api/system/health/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["ready"], payload)
        self.assertEqual(payload["database"]["integrity"], "ok")
        self.assertTrue(payload["foreignKeys"]["ok"])
        self.assertEqual(payload["migrations"]["pendingCount"], 0)
        self.assertTrue(payload["snapshots"]["defaultExists"])
        self.assertIn("backups", payload)
        self.assertIn("checks", payload)

    @override_settings(LAN_ACCESS=True)
    def test_system_network_reports_local_only_startup_link(self):
        response = self.client.get("/api/system/network/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertFalse(payload["lanAccess"])
        self.assertEqual(payload["bindHost"], "127.0.0.1")
        self.assertIn("127.0.0.1", payload["localUrl"])
        self.assertEqual(payload["lanUrls"], [])
        self.assertNotIn("phoneUrl", payload)
        self.assertNotIn("phoneUrls", payload)

    @override_settings(ALLOWED_HOSTS=["testserver", "192.168.1.10"], LAN_ACCESS=False)
    def test_desktop_local_only_blocks_lan_when_disabled(self):
        response = self.client.get(
            "/api/health/",
            HTTP_HOST="192.168.1.10:8765",
            REMOTE_ADDR="192.168.1.22",
        )

        self.assertEqual(response.status_code, 403)

    @override_settings(ALLOWED_HOSTS=["testserver", "192.168.1.10"], LAN_ACCESS=True)
    def test_desktop_local_only_blocks_lan_even_if_enabled(self):
        response = self.client.get(
            "/api/health/",
            HTTP_HOST="192.168.1.10:8765",
            REMOTE_ADDR="192.168.1.22",
        )

        self.assertEqual(response.status_code, 403)

    def test_sync_duplicate_unit_barcode_does_not_block_other_sections(self):
        payload = self.sync_payload(
            warehouses=[
                {"id": "wh-new", "name": "New Warehouse", "code": "", "zone": "", "manager": "", "note": ""}
            ],
            clients=[
                {"id": "client-new", "name": "New Client", "phone": "", "openingBalanceUsd": "0"}
            ],
            suppliers=[
                {"id": "supplier-new", "name": "New Supplier", "phone": "", "openingBalanceUsd": "0"}
            ],
            products=[
                {
                    "id": "prod-bad",
                    "name": "Bad Product",
                    "warehouseId": "wh-new",
                    "baseUnit": "piece",
                    "units": [
                        {"id": "unit-a", "name": "piece", "multiplier": "1", "priceUsd": "1", "barcode": "DUP-1"},
                        {"id": "unit-b", "name": "box", "multiplier": "6", "priceUsd": "6", "barcode": "DUP-1"},
                    ],
                }
            ],
        )

        response = self.client.post("/api/sync/", data=payload, content_type="application/json")

        self.assertEqual(response.status_code, 207)
        body = response.json()
        self.assertTrue(body["syncHasErrors"])
        self.assertEqual(body["syncReport"]["errors"][0]["code"], "DUPLICATE_BARCODE")
        self.assertEqual(body["syncReport"]["errors"][0]["details"]["barcode"], "DUP-1")
        self.assertEqual(body["syncReport"]["errors"][0]["field"], "barcode")
        self.assertEqual(body["syncReport"]["errors"][0]["entityId"], "prod-bad")
        self.assertIn("messageAr", body["syncReport"]["errors"][0])
        self.assertIn("first", body["syncReport"]["errors"][0]["ownerDetails"])
        self.assertTrue(Warehouse.objects.filter(external_id="wh-new", deleted_at__isnull=True).exists())
        self.assertTrue(Client.objects.filter(external_id="client-new", deleted_at__isnull=True).exists())
        self.assertTrue(Supplier.objects.filter(external_id="supplier-new", deleted_at__isnull=True).exists())
        self.assertFalse(Product.objects.filter(external_id="prod-bad", deleted_at__isnull=True).exists())

    def test_sync_duplicate_product_barcode_reports_owner_details(self):
        payload = self.sync_payload(
            products=[
                {
                    "id": "prod-a",
                    "name": "Product A",
                    "warehouseId": self.warehouse.external_id,
                    "barcode": "٣٠",
                    "baseUnit": "piece",
                    "units": [],
                },
                {
                    "id": "prod-b",
                    "name": "Product B",
                    "warehouseId": self.warehouse.external_id,
                    "barcode": "30",
                    "baseUnit": "piece",
                    "units": [],
                },
            ]
        )

        response = self.client.post("/api/sync/", data=payload, content_type="application/json")

        self.assertEqual(response.status_code, 207)
        body = response.json()
        self.assertEqual(body["syncReport"]["errors"][0]["code"], "DUPLICATE_BARCODE")
        details = body["syncReport"]["errors"][0]["details"]
        self.assertEqual(details["barcode"], "30")
        self.assertEqual(details["first"]["source"], "product")
        self.assertEqual(details["second"]["source"], "product")

    def test_product_create_rejects_barcode_used_by_existing_unit(self):
        self.unit.barcode = "30"
        self.unit.save(update_fields=["barcode"])

        response = self.client.post(
            "/api/products/",
            data={
                "id": "prod-new",
                "name": "New Product",
                "warehouseId": self.warehouse.external_id,
                "barcode": "30",
                "baseUnit": "piece",
                "units": [],
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        body = response.json()
        self.assertEqual(body["code"], "DUPLICATE_BARCODE")
        self.assertEqual(body["details"]["first"]["source"], "unit")
        self.assertEqual(body["details"]["first"]["unitId"], self.unit.external_id)
        self.assertFalse(Product.objects.filter(external_id="prod-new").exists())

    def test_product_create_rejects_case_variant_of_existing_unit_barcode(self):
        self.unit.barcode = "Box-30"
        self.unit.save(update_fields=["barcode"])

        response = self.client.post(
            "/api/products/",
            data={
                "id": "prod-new",
                "name": "New Product",
                "warehouseId": self.warehouse.external_id,
                "barcode": "box-30",
                "baseUnit": "piece",
                "units": [],
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "DUPLICATE_BARCODE")

    def test_product_update_rejects_unit_barcode_used_by_another_product(self):
        other_product = Product.objects.create(
            external_id="prod-other",
            warehouse=self.warehouse,
            name="Other Product",
            barcode="30",
        )
        response = self.client.patch(
            f"/api/products/{self.product.external_id}/",
            data={
                "units": [
                    {
                        "id": self.unit.external_id,
                        "name": self.unit.name,
                        "multiplier": str(self.unit.multiplier),
                        "priceUsd": str(self.unit.price_usd),
                        "barcode": "30",
                    }
                ]
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        body = response.json()
        self.assertEqual(body["code"], "DUPLICATE_BARCODE")
        self.assertEqual(body["details"]["first"]["source"], "product")
        self.assertEqual(body["details"]["first"]["productId"], other_product.external_id)
        self.assertEqual(body["details"]["second"]["source"], "unit")
        self.unit.refresh_from_db()
        self.assertEqual(self.unit.barcode, "")

    def test_product_delete_archives_product_with_history(self):
        self.product.barcode = "20"
        self.product.save(update_fields=["barcode"])
        self.unit.barcode = "30"
        self.unit.save(update_fields=["barcode"])
        StockBatch.objects.create(product=self.product, warehouse=self.warehouse, quantity=Decimal("5"))
        StockMovement.objects.create(product=self.product, warehouse=self.warehouse, movement_type="adjustment", quantity=Decimal("5"))

        response = self.client.delete(f"/api/products/{self.product.external_id}/")

        self.assertEqual(response.status_code, 200)
        self.product.refresh_from_db()
        self.unit.refresh_from_db()
        self.assertIsNotNone(self.product.deleted_at)
        self.assertIsNotNone(self.unit.deleted_at)
        self.assertEqual(self.product.barcode, "")
        self.assertEqual(self.unit.barcode, "")
        self.assertEqual(StockBatch.objects.count(), 2)
        self.assertEqual(StockMovement.objects.count(), 1)

    def test_sync_ignores_units_left_on_archived_products(self):
        stale_product = Product.objects.create(
            external_id="prod-archived",
            warehouse=self.warehouse,
            name="Archived Product",
            deleted_at=timezone.now(),
        )
        ProductUnit.objects.create(
            external_id="archived-unit",
            product=stale_product,
            name="box",
            multiplier=Decimal("6"),
            barcode="30",
        )
        payload = self.sync_payload(
            products=[
                {
                    "id": "prod-new",
                    "name": "New Product",
                    "warehouseId": self.warehouse.external_id,
                    "barcode": "30",
                    "baseUnit": "piece",
                    "units": [],
                }
            ],
        )

        response = self.client.post("/api/sync/", data=payload, content_type="application/json")

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["syncHasErrors"])
        self.assertTrue(Product.objects.filter(external_id="prod-new", barcode="30", deleted_at__isnull=True).exists())

    def test_sync_allows_same_product_unit_barcode_when_unit_id_changes(self):
        self.product.name = "كيك رول"
        self.product.barcode = "20"
        self.product.save(update_fields=["name", "barcode"])
        self.unit.name = "كارتون"
        self.unit.multiplier = Decimal("24")
        self.unit.barcode = "30"
        self.unit.save(update_fields=["name", "multiplier", "barcode"])
        payload = self.sync_payload(
            products=[
                {
                    "id": self.product.external_id,
                    "name": self.product.name,
                    "warehouseId": self.warehouse.external_id,
                    "barcode": "20",
                    "baseUnit": "قطعة",
                    "units": [
                        {"id": "unit-new-carton", "name": "كارتون", "multiplier": "24", "priceUsd": "5", "barcode": "30"},
                    ],
                },
                {
                    "id": "prod-new",
                    "name": "كيك بان",
                    "warehouseId": self.warehouse.external_id,
                    "barcode": "02020",
                    "baseUnit": "قطعة",
                    "units": [
                        {"id": "prod-new-piece", "name": "قطعة", "multiplier": "1", "priceUsd": "1", "barcode": ""},
                        {"id": "prod-new-carton", "name": "كارتون 24", "multiplier": "24", "priceUsd": "8", "barcode": "9292"},
                    ],
                },
            ],
        )

        response = self.client.post("/api/sync/", data=payload, content_type="application/json")

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["syncHasErrors"])
        self.assertFalse(ProductUnit.objects.filter(external_id=self.unit.external_id).exists())
        self.assertTrue(ProductUnit.objects.filter(product=self.product, external_id="unit-new-carton", barcode="30").exists())
        self.assertTrue(Product.objects.filter(external_id="prod-new", barcode="02020", deleted_at__isnull=True).exists())

    def test_sync_keeps_referenced_obsolete_product_unit_active(self):
        invoice = Invoice.objects.create(
            external_id="inv-unit-ref",
            customer_name="Walk in",
            subtotal_usd=Decimal("100.0000"),
            total_usd=Decimal("100.0000"),
        )
        InvoiceItem.objects.create(
            invoice=invoice,
            product=self.product,
            warehouse=self.warehouse,
            unit_id=self.unit.external_id,
            unit_name=self.unit.name,
            quantity=Decimal("1.0000"),
            qty_in_base=Decimal("1.0000"),
            price_usd=Decimal("100.0000"),
            total_usd=Decimal("100.0000"),
        )
        payload = self.sync_payload(
            products=[
                {
                    "id": self.product.external_id,
                    "name": self.product.name,
                    "warehouseId": self.warehouse.external_id,
                    "baseUnit": "piece",
                    "units": [
                        {"id": "unit-new-piece", "name": "new piece", "multiplier": "1", "priceUsd": "100", "barcode": ""},
                    ],
                }
            ],
        )

        response = self.client.post("/api/sync/", data=payload, content_type="application/json")

        self.assertEqual(response.status_code, 200)
        self.unit.refresh_from_db()
        self.assertIsNone(self.unit.deleted_at)
        self.assertTrue(ProductUnit.objects.filter(product=self.product, external_id="unit-new-piece").exists())

    def test_sync_creates_base_unit_when_product_payload_has_no_units(self):
        self.unit.delete()
        payload = self.sync_payload(
            products=[
                {
                    "id": self.product.external_id,
                    "name": self.product.name,
                    "warehouseId": self.warehouse.external_id,
                    "baseUnit": "piece",
                    "units": [],
                }
            ],
        )

        response = self.client.post("/api/sync/", data=payload, content_type="application/json")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(ProductUnit.objects.filter(product=self.product, external_id=f"{self.product.external_id}-unit").exists())

    def test_sync_missing_product_warehouse_returns_clear_partial_error(self):
        payload = self.sync_payload(
            products=[
                {
                    "id": "prod-missing-warehouse",
                    "name": "Missing Warehouse Product",
                    "warehouseId": "wh-missing",
                    "baseUnit": "piece",
                    "units": [],
                }
            ]
        )

        response = self.client.post("/api/sync/", data=payload, content_type="application/json")

        self.assertEqual(response.status_code, 207)
        body = response.json()
        self.assertTrue(body["syncHasErrors"])
        self.assertEqual(body["syncReport"]["errors"][0]["code"], "MISSING_WAREHOUSE")
        self.assertFalse(Product.objects.filter(external_id="prod-missing-warehouse").exists())


class SystemResetTests(TransactionTestCase):
    def setUp(self):
        self.backup_dir = TemporaryDirectory()
        self.addCleanup(self.backup_dir.cleanup)
        self.backup_settings = override_settings(
            BACKUP_DIR=Path(self.backup_dir.name),
            RUNTIME_DIR=Path(self.backup_dir.name) / ".runtime",
        )
        self.backup_settings.enable()
        self.addCleanup(self.backup_settings.disable)
        self.admin = User.objects.create_superuser(username="admin", password="pass")
        self.staff = User.objects.create_user(username="cashier", password="pass")
        self.client.force_login(self.admin)

    def test_system_reset_clears_business_data_and_preserves_admin_settings(self):
        AppSnapshot.objects.create(
            key="default",
            data={
                "theme": "tox-blue",
                "lang": "ar",
                "currency": "IQD",
                "exchangeRate": 1460,
                "businessName": "Main Store",
                "warehouses": [{"id": "old"}],
                "clients": [{"id": "old-client"}],
            },
        )
        Warehouse.objects.create(external_id="wh-1", name="Main")
        Client.objects.create(external_id="cust-1", name="Customer")
        Supplier.objects.create(external_id="sup-1", name="Supplier")
        Employee.objects.create(external_id="emp-1", name="Employee")

        response = self.client.post(
            "/api/system/reset/",
            data={"confirmation": "RESET", "adminPassword": "pass"},
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["ok"])
        self.assertEqual(Warehouse.objects.count(), 0)
        self.assertEqual(Product.objects.count(), 0)
        self.assertEqual(Client.objects.count(), 0)
        self.assertEqual(Supplier.objects.count(), 0)
        self.assertEqual(Employee.objects.count(), 0)
        self.assertTrue(User.objects.filter(username="admin", is_superuser=True).exists())
        self.assertFalse(User.objects.filter(username="cashier").exists())
        snapshot = AppSnapshot.objects.get(key="default").data
        self.assertEqual(snapshot["businessName"], "Main Store")
        self.assertEqual(snapshot["warehouses"], [])
        self.assertEqual(snapshot["clients"], [])
        self.assertEqual(snapshot["products"], [])
        self.assertEqual(snapshot["invoices"], [])
        self.assertEqual(snapshot["purchases"], [])
        self.assertEqual(snapshot["suppliers"], [])
        self.assertTrue(snapshot["dataGeneration"].startswith("reset-"))

    def test_system_reset_requires_current_admin_password(self):
        missing = self.client.post(
            "/api/system/reset/",
            data={"confirmation": "RESET"},
            content_type="application/json",
        )
        self.assertEqual(missing.status_code, 400)
        self.assertEqual(missing.json()["reason"], "ADMIN_PASSWORD_REQUIRED")

        wrong = self.client.post(
            "/api/system/reset/",
            data={"confirmation": "RESET", "adminPassword": "wrong"},
            content_type="application/json",
        )
        self.assertEqual(wrong.status_code, 403)
        self.assertEqual(wrong.json()["reason"], "INVALID_ADMIN_PASSWORD")

    def test_backup_restore_rejects_legacy_json_without_touching_database(self):
        AppSnapshot.objects.create(
            key="default",
            data={
                "dataGeneration": "current-generation",
                "theme": "tox-blue",
                "warehouses": [{"id": "old"}],
            },
        )
        Warehouse.objects.create(external_id="old-wh", name="Old Warehouse")
        restore_payload = {
            "dataGeneration": "old-backup-generation",
            "theme": "coffee",
            "lang": "ar",
            "currency": "IQD",
            "exchangeRate": 1460,
            "warehouses": [{"id": "new-wh", "name": "New Warehouse", "code": "NEW"}],
            "clients": [{"id": "new-client", "name": "New Client"}],
            "suppliers": [],
            "products": [],
            "employees": [],
            "invoices": [],
            "purchases": [],
            "clientPayments": [],
            "supplierPayments": [],
            "accountMovements": [],
            "suspendedInvoices": [],
            "suspendedPurchases": [],
            "unitPresets": [],
            "brands": [],
            "originCountries": [],
        }

        response = self.client.post(
            "/api/backup/restore/",
            data=json.dumps(restore_payload),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertEqual(payload["reason"], "LEGACY_BACKUP_DISABLED")
        self.assertTrue(Warehouse.objects.filter(external_id="old-wh").exists())
        self.assertFalse(Warehouse.objects.filter(external_id="new-wh").exists())
        self.assertFalse(Client.objects.filter(external_id="new-client").exists())
        self.assertEqual(AppSnapshot.objects.get(key="default").data["dataGeneration"], "current-generation")
        self.assertTrue(User.objects.filter(username="admin", is_superuser=True).exists())
        self.assertTrue(AuditLog.objects.filter(action="backup_restore_failed", data__reason="LEGACY_BACKUP_DISABLED").exists())

    def test_backup_export_returns_uncompressed_unified_json(self):
        AppSnapshot.objects.create(key="default", data={"theme": "coffee", "businessName": "Unified Store"})
        Warehouse.objects.create(external_id="json-wh", name="JSON Warehouse")

        response = self.client.get("/api/backup/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/json")
        payload = response.json()
        self.assertEqual(payload["manifest"]["format"], "tox-json-full-backup")
        self.assertEqual(payload["manifest"]["version"], 1)
        self.assertTrue(payload["databaseBase64"])
        self.assertEqual(payload["state"]["businessName"], "Unified Store")
        self.assertIn("database", payload["manifest"]["files"])
        self.assertIn("erp_warehouse", payload["manifest"]["recordCounts"])

    def test_backup_export_accepts_bearer_token_auth(self):
        self.client.logout()

        response = self.client.get(
            "/api/backup/",
            HTTP_AUTHORIZATION=f"Bearer {create_access_token(self.admin)}",
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["manifest"]["format"], "tox-json-full-backup")

    def test_backup_verify_rejects_legacy_json_and_logs_failure(self):
        legacy_payload = {
            "dataGeneration": "old-local-generation",
            "warehouses": [{"id": "legacy-wh", "name": "Legacy Warehouse"}],
        }

        verify = self.client.post(
            "/api/backup/verify/",
            data=json.dumps(legacy_payload),
            content_type="application/json",
        )

        self.assertEqual(verify.status_code, 400)
        self.assertEqual(verify.json()["reason"], "LEGACY_BACKUP_DISABLED")
        log = AuditLog.objects.filter(action="backup_verify_failed").first()
        self.assertIsNotNone(log)
        self.assertEqual(log.data["reason"], "LEGACY_BACKUP_DISABLED")
        self.assertEqual(log.data["details"]["requiredFormat"], "tox-json-full-backup")

    def test_backup_verify_logs_successful_unified_json(self):
        backup = self.client.get("/api/backup/").content

        verify = self.client.post(
            "/api/backup/verify/",
            data=backup,
            content_type="application/json",
        )

        self.assertEqual(verify.status_code, 200, verify.content)
        log = AuditLog.objects.filter(action="backup_verify_ok").first()
        self.assertIsNotNone(log)
        self.assertEqual(log.data["format"], "tox-json-full-backup")
        self.assertGreater(log.data["size"], 0)
        self.assertTrue(log.data["sha256"])

    def test_backup_verify_accepts_large_unified_json_backup(self):
        AppSnapshot.objects.update_or_create(
            key="default",
            defaults={"data": {"businessName": "Large Backup Store", "largeBackupPad": "x" * 3_000_000}},
        )
        backup = self.client.get("/api/backup/").content
        self.assertGreater(len(backup), 2_500_000)

        verify = self.client.post(
            "/api/backup/verify/",
            data=backup,
            content_type="application/json",
        )

        self.assertEqual(verify.status_code, 200, verify.content[:500])
        self.assertTrue(verify.json()["ok"])

    @override_settings(DATA_UPLOAD_MAX_MEMORY_SIZE=128)
    def test_backup_verify_returns_json_when_django_upload_guard_trips(self):
        backup = self.client.get("/api/backup/").content

        verify = self.client.post(
            "/api/backup/verify/",
            data=backup,
            content_type="application/json",
        )

        self.assertEqual(verify.status_code, 413)
        self.assertEqual(verify.json()["reason"], "PAYLOAD_TOO_LARGE")
        self.assertEqual(verify.json()["code"], "PAYLOAD_TOO_LARGE")
        self.assertIn("messageAr", verify.json())
        self.assertEqual(verify.json()["limitBytes"], 128)
        self.assertGreater(verify.json()["providedBytes"], 128)

    def test_unified_backup_restore_after_reset_restores_complete_database(self):
        UserProfile.objects.update_or_create(user=self.staff, defaults={
            "role": "cashier",
            "permissions": {"sales.open": True, "admin.backup": False},
        })
        AppSnapshot.objects.create(key="default", data={"businessName": "Unified Complete Store", "theme": "coffee"})
        Warehouse.objects.create(external_id="json-restore-wh", name="JSON Restore Warehouse")

        backup = self.client.get("/api/backup/").content
        reset = self.client.post(
            "/api/system/reset/",
            data={"confirmation": "RESET", "adminPassword": "pass"},
            content_type="application/json",
        )
        self.assertEqual(reset.status_code, 200)
        self.assertFalse(User.objects.filter(username="cashier").exists())
        self.assertFalse(Warehouse.objects.filter(external_id="json-restore-wh").exists())

        restore = self.client.post(
            "/api/backup/restore/",
            data=backup,
            content_type="application/json",
        )

        self.assertEqual(restore.status_code, 200)
        payload = restore.json()
        self.assertTrue(payload["ok"])
        self.assertTrue(payload["unifiedBackupRestored"])
        self.assertTrue(User.objects.filter(username="cashier").exists())
        self.assertEqual(UserProfile.objects.get(user__username="cashier").permissions["sales.open"], True)
        self.assertTrue(Warehouse.objects.filter(external_id="json-restore-wh").exists())
        self.assertEqual(AppSnapshot.objects.get(key="default").data["businessName"], "Unified Complete Store")
        self.assertTrue(payload["backup"]["safetyBackupPath"].endswith(".json"))
        restore_log = AuditLog.objects.filter(action="backup_restore").first()
        self.assertIsNotNone(restore_log)
        self.assertEqual(restore_log.data["format"], "tox-json-full-backup")

    def test_unified_backup_restore_recovers_when_only_state_checksum_changed(self):
        AppSnapshot.objects.create(key="default", data={"businessName": "Recoverable Store", "theme": "coffee"})
        Warehouse.objects.create(external_id="recoverable-wh", name="Recoverable Warehouse")
        response = self.client.get("/api/backup/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        payload["state"]["businessName"] = "Tampered by browser stringify"

        reset = self.client.post(
            "/api/system/reset/",
            data={"confirmation": "RESET", "adminPassword": "pass"},
            content_type="application/json",
        )
        self.assertEqual(reset.status_code, 200)
        self.assertFalse(Warehouse.objects.filter(external_id="recoverable-wh").exists())

        restore = self.client.post(
            "/api/backup/restore/",
            data=json.dumps(payload),
            content_type="application/json",
        )

        self.assertEqual(restore.status_code, 200, restore.content)
        restored = restore.json()
        self.assertTrue(restored["ok"])
        self.assertEqual(restored["warnings"][0]["code"], "STATE_CHECKSUM_RECOVERED")
        self.assertTrue(Warehouse.objects.filter(external_id="recoverable-wh").exists())
        self.assertEqual(AppSnapshot.objects.get(key="default").data["businessName"], "Recoverable Store")

    def test_unified_backup_restore_rejects_database_checksum_failure(self):
        response = self.client.get("/api/backup/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        db_bytes = bytearray(base64.b64decode(payload["databaseBase64"].encode("ascii")))
        db_bytes[0] = (db_bytes[0] + 1) % 255
        payload["databaseBase64"] = base64.b64encode(bytes(db_bytes)).decode("ascii")

        restore = self.client.post(
            "/api/backup/restore/",
            data=json.dumps(payload),
            content_type="application/json",
        )

        self.assertEqual(restore.status_code, 400)
        self.assertEqual(restore.json()["reason"], "CHECKSUM_FAILED")
        self.assertEqual(restore.json()["details"]["file"], "database")
        self.assertTrue(AuditLog.objects.filter(action="backup_restore_failed", data__reason="CHECKSUM_FAILED").exists())

    def test_backup_verify_reports_recoverable_state_checksum_warning(self):
        response = self.client.get("/api/backup/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        payload["state"]["businessName"] = "Tampered by browser stringify"

        verify = self.client.post(
            "/api/backup/verify/",
            data=json.dumps(payload),
            content_type="application/json",
        )

        self.assertEqual(verify.status_code, 200)
        body = verify.json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["warnings"][0]["code"], "STATE_CHECKSUM_RECOVERED")

    def test_unified_backup_restore_rejects_unsupported_version_with_details(self):
        response = self.client.get("/api/backup/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        payload["manifest"]["version"] = 999

        restore = self.client.post(
            "/api/backup/restore/",
            data=json.dumps(payload),
            content_type="application/json",
        )

        self.assertEqual(restore.status_code, 400)
        self.assertEqual(restore.json()["reason"], "UNSUPPORTED_BACKUP")
        self.assertEqual(restore.json()["details"]["version"], 999)

    def test_json_backup_export_contains_manifest_database_and_state(self):
        AppSnapshot.objects.create(key="default", data={"theme": "coffee", "businessName": "Full Store"})
        Warehouse.objects.create(external_id="full-wh", name="Full Warehouse")

        response = self.client.get("/api/backup/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/json")
        payload = response.json()
        manifest = payload["manifest"]

        self.assertEqual(manifest["format"], "tox-json-full-backup")
        self.assertEqual(manifest["version"], 1)
        self.assertIn("databaseBase64", payload)
        self.assertEqual(payload["state"]["businessName"], "Full Store")
        self.assertIn("erp_warehouse", manifest["recordCounts"])

    def test_full_zip_backup_verify_is_disabled(self):
        verify = self.client.post(
            "/api/backup/full/verify/",
            data=b"PK\x03\x04legacy",
            content_type="application/zip",
        )

        self.assertEqual(verify.status_code, 400)
        self.assertEqual(verify.json()["reason"], "ZIP_BACKUP_DISABLED")

    def test_full_zip_backup_restore_is_disabled(self):
        restore = self.client.post(
            "/api/backup/full/restore/",
            data=b"PK\x03\x04legacy",
            content_type="application/zip",
        )

        self.assertEqual(restore.status_code, 400)
        self.assertEqual(restore.json()["reason"], "ZIP_BACKUP_DISABLED")

    def test_full_zip_backup_export_is_disabled(self):
        response = self.client.get("/api/backup/full/")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["reason"], "ZIP_BACKUP_DISABLED")

    def test_unified_restore_endpoint_rejects_zip_backup(self):
        UserProfile.objects.update_or_create(user=self.staff, defaults={
            "role": "cashier",
            "permissions": {"sales.open": True, "admin.backup": False},
        })
        Warehouse.objects.create(external_id="zip-unified-wh", name="ZIP Unified Warehouse")

        restore = self.client.post(
            "/api/backup/restore/",
            data=b"PK\x03\x04legacy",
            content_type="application/zip",
        )

        self.assertEqual(restore.status_code, 400)
        self.assertEqual(restore.json()["reason"], "ZIP_BACKUP_DISABLED")
        self.assertTrue(Warehouse.objects.filter(external_id="zip-unified-wh").exists())

    def test_full_backup_restore_uses_sqlite_backup_when_wal_is_locked(self):
        with patch("erp.api._active_db_path", return_value=Path("locked.sqlite3")), \
             patch("erp.api._discard_sqlite_sidecars", side_effect=[["locked.sqlite3-wal"], []]), \
             patch("erp.api._copy_sqlite_backup_to_path") as copy_backup, \
             patch("erp.api.call_command") as call_command:
            api._replace_active_sqlite_database(Path("restored.sqlite3"))

        copy_backup.assert_called_once_with(Path("restored.sqlite3"), Path("locked.sqlite3"))
        call_command.assert_called_once_with("migrate", interactive=False, verbosity=0)

    def test_json_backup_restore_after_reset_restores_complete_database(self):
        UserProfile.objects.update_or_create(user=self.staff, defaults={
            "role": "cashier",
            "permissions": {"sales.open": True, "admin.backup": False},
        })
        AppSnapshot.objects.create(
            key="default",
            data={
                "theme": "coffee",
                "lang": "ar",
                "businessName": "Complete Store",
                "invoicePrintSettings": {"designer": {"brand": {"logoSource": "uploaded"}}},
            },
        )
        warehouse = Warehouse.objects.create(external_id="restore-wh", name="Restore Warehouse")
        product = Product.objects.create(
            external_id="restore-product",
            warehouse=warehouse,
            name="Restore Product",
            image="data:image/webp;base64,restore",
            stock_quantity=Decimal("12.0000"),
        )
        ProductUnit.objects.create(external_id="restore-unit", product=product, name="piece", multiplier=Decimal("1"), price_usd=Decimal("15"))
        client = Client.objects.create(external_id="restore-client", name="Restore Client", image="data:image/png;base64,client")
        supplier = Supplier.objects.create(external_id="restore-supplier", name="Restore Supplier", image="data:image/png;base64,supplier")
        invoice = Invoice.objects.create(
            external_id="restore-invoice",
            client=client,
            total_usd=Decimal("15.0000"),
            paid_usd=Decimal("15.0000"),
            payment_status="paid",
        )
        InvoiceItem.objects.create(
            invoice=invoice,
            product=product,
            warehouse=warehouse,
            unit_id="restore-unit",
            unit_name="piece",
            quantity=Decimal("1"),
            qty_in_base=Decimal("1"),
            price_usd=Decimal("15.0000"),
            total_usd=Decimal("15.0000"),
        )
        purchase = Purchase.objects.create(
            external_id="restore-purchase",
            supplier=supplier,
            cost_usd=Decimal("9.0000"),
            paid_usd=Decimal("9.0000"),
            payment_status="paid",
        )
        PurchaseItem.objects.create(
            purchase=purchase,
            product=product,
            warehouse=warehouse,
            unit_id="restore-unit",
            unit_name="piece",
            quantity=Decimal("1"),
            qty_in_base=Decimal("1"),
            unit_cost_usd=Decimal("9.0000"),
            total_usd=Decimal("9.0000"),
        )

        backup = self.client.get("/api/backup/").content
        reset = self.client.post(
            "/api/system/reset/",
            data={"confirmation": "RESET", "adminPassword": "pass"},
            content_type="application/json",
        )
        self.assertEqual(reset.status_code, 200)
        self.assertFalse(User.objects.filter(username="cashier").exists())
        self.assertFalse(Product.objects.filter(external_id="restore-product").exists())

        restore = self.client.post(
            "/api/backup/restore/",
            data=backup,
            content_type="application/json",
        )

        self.assertEqual(restore.status_code, 200)
        payload = restore.json()
        self.assertTrue(payload["ok"])
        self.assertTrue(payload["unifiedBackupRestored"])
        self.assertTrue(User.objects.filter(username="cashier").exists())
        restored_profile = UserProfile.objects.get(user__username="cashier")
        self.assertEqual(restored_profile.role, "cashier")
        self.assertEqual(restored_profile.permissions["sales.open"], True)
        self.assertEqual(Product.objects.get(external_id="restore-product").image, "data:image/webp;base64,restore")
        self.assertTrue(Invoice.objects.filter(external_id="restore-invoice").exists())
        self.assertTrue(Purchase.objects.filter(external_id="restore-purchase").exists())
        self.assertEqual(AppSnapshot.objects.get(key="default").data["businessName"], "Complete Store")
        self.assertTrue(payload["backup"]["safetyBackupPath"])


class DashboardReviewApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_superuser(username="dashboard-admin", password="pass")
        self.client.force_login(self.user)

    def review_payload(self, status="stable", score=100, issues=None):
        issues = issues or []
        return {
            "status": status,
            "score": score,
            "checkedAt": "2026-06-02T21:23:00+03:00",
            "checks": [
                {"id": "Equal_size_icons", "label": "اتساق الأيقونات", "ok": True, "issue": ""},
                {"id": "Grid_UI_alignment", "label": "تنظيم الشبكة", "ok": not issues, "issue": "Grid issue" if issues else ""},
            ],
            "issues": issues,
        }

    def test_dashboard_review_stores_stable_audit_log(self):
        response = self.client.post(
            "/api/dashboard-review/",
            data=self.review_payload(),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["review"]["status"], "stable")
        log = AuditLog.objects.get(action="dashboard_design_review")
        self.assertEqual(log.entity_type, "dashboard")
        self.assertEqual(log.entity_id, "main_center")
        self.assertEqual(log.data["score"], 100)

    def test_dashboard_review_stores_unstable_issues_and_gets_latest(self):
        first = self.client.post(
            "/api/dashboard-review/",
            data=self.review_payload(status="stable", score=100),
            content_type="application/json",
        )
        second = self.client.post(
            "/api/dashboard-review/",
            data=self.review_payload(
                status="unstable",
                score=86,
                issues=[{"id": "Remove_extra_text_UI", "message": "توجد نصوص طويلة"}],
            ),
            content_type="application/json",
        )
        latest = self.client.get("/api/dashboard-review/")

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 201)
        self.assertEqual(latest.status_code, 200)
        self.assertEqual(latest.json()["review"]["status"], "unstable")
        self.assertEqual(latest.json()["review"]["score"], 86)
        self.assertEqual(AuditLog.objects.filter(action="dashboard_design_review").count(), 2)

    def test_dashboard_review_rejects_invalid_payload(self):
        invalid_status = self.client.post(
            "/api/dashboard-review/",
            data={"status": "ok", "score": 100, "checks": [], "issues": []},
            content_type="application/json",
        )
        missing_lists = self.client.post(
            "/api/dashboard-review/",
            data={"status": "stable", "score": 100},
            content_type="application/json",
        )

        self.assertEqual(invalid_status.status_code, 400)
        self.assertEqual(invalid_status.json()["reason"], "INVALID_REVIEW_STATUS")
        self.assertEqual(missing_lists.status_code, 400)
        self.assertEqual(missing_lists.json()["reason"], "INVALID_REVIEW_PAYLOAD")

    def test_dashboard_review_accepts_bearer_token_auth(self):
        self.client.logout()
        response = self.client.post(
            "/api/dashboard-review/",
            data=self.review_payload(status="unstable", score=71, issues=[{"id": "Equal_size_icons", "message": "Icons mismatch"}]),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {create_access_token(self.user)}",
        )

        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["review"]["status"], "unstable")


class EmployeeAccountApiTests(TestCase):
    def setUp(self):
        self.admin = User.objects.filter(username="user", is_superuser=True).first()
        if not self.admin:
            self.admin = User.objects.create_superuser(username="user", password="pass")
        else:
            self.admin.set_password("pass")
            self.admin.is_active = True
            self.admin.is_staff = True
            self.admin.is_superuser = True
            self.admin.save()
        UserProfile.objects.update_or_create(user=self.admin, defaults={"role": "admin", "permissions": {}})
        self.client.force_login(self.admin)

    def test_creating_user_also_creates_linked_employee_profile(self):
        response = self.client.post(
            "/api/users/",
            data={
                "name": "Sara Khalid",
                "username": "sara",
                "password": "secret123",
                "role": "accountant",
                "phone": "07701234567",
                "salary": "850000",
                "workHours": "8",
                "permissions": {
                    "accounts.open": True,
                    "accounts.view_profits": True,
                    "accounts.view_expenses": True,
                    "accounts.manage_debts": True,
                    "sales.open": False,
                },
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201)
        payload = response.json()["user"]
        self.assertEqual(payload["employee"]["phone"], "07701234567")
        self.assertEqual(payload["employee"]["salary"], 850000.0)
        self.assertEqual(payload["employee"]["workHours"], 8.0)
        self.assertEqual(payload["employee"]["role"], "accountant")

        user = User.objects.get(username="sara")
        employee = Employee.objects.get(user=user)
        self.assertEqual(employee.phone, "07701234567")
        self.assertEqual(employee.salary, Decimal("850000"))
        self.assertEqual(employee.work_hours, Decimal("8"))
        self.assertEqual(employee.role, "accountant")

    def test_updating_user_syncs_employee_profile_and_records_payroll(self):
        user = User.objects.create_user(username="worker", password="secret123", first_name="Worker")
        UserProfile.objects.create(user=user, role="cashier", permissions={"sales.open": True})

        patch_response = self.client.patch(
            f"/api/users/{user.id}/",
            data=json.dumps({
                "name": "Worker Prime",
                "phone": "07800000000",
                "salary": "650000",
                "workHours": "7.5",
                "permissions": {"sales.open": True, "sales.print_invoice": True},
            }),
            content_type="application/json",
        )

        self.assertEqual(patch_response.status_code, 200)
        employee = Employee.objects.get(user=user)
        self.assertEqual(employee.name, "Worker Prime")
        self.assertEqual(employee.phone, "07800000000")
        self.assertEqual(employee.salary, Decimal("650000"))
        self.assertEqual(employee.work_hours, Decimal("7.5"))

        payroll_response = self.client.post(
            f"/api/users/{user.id}/payroll/",
            data={"amountIqd": "650000", "note": "Salary payout"},
            content_type="application/json",
        )

        self.assertEqual(payroll_response.status_code, 201)
        entry = EmployeePayroll.objects.get(employee=employee)
        self.assertEqual(entry.amount_iqd, Decimal("650000"))
        self.assertEqual(entry.note, "Salary payout")

    def test_users_endpoint_purges_orphan_demo_accounts(self):
        User.objects.create_user(username="ali", password="secret123", first_name="Ali")

        response = self.client.get("/api/users/")

        self.assertEqual(response.status_code, 200)
        usernames = [item["username"] for item in response.json()["users"]]
        self.assertNotIn("ali", usernames)
        self.assertFalse(User.objects.filter(username="ali").exists())

    def test_default_admin_only_allows_credential_updates(self):
        Employee.objects.create(
            user=self.admin,
            external_id="emp-admin",
            name="Admin",
            role="admin",
            salary=Decimal("900000"),
            work_hours=Decimal("8"),
        )

        blocked_response = self.client.patch(
            f"/api/users/{self.admin.id}/",
            data=json.dumps({
                "name": "Not Allowed",
                "role": "cashier",
                "isActive": False,
                "permissions": {"sales.open": False},
                "salary": "1",
                "workHours": "1",
            }),
            content_type="application/json",
        )

        self.assertEqual(blocked_response.status_code, 400)
        self.assertEqual(blocked_response.json()["reason"], "PROTECTED_USER")
        self.admin.refresh_from_db()
        profile = UserProfile.objects.get(user=self.admin)
        employee = Employee.objects.get(user=self.admin)
        self.assertTrue(self.admin.is_active)
        self.assertTrue(self.admin.is_superuser)
        self.assertEqual(profile.role, "admin")
        self.assertEqual(profile.permissions, {})
        self.assertEqual(employee.salary, Decimal("900000"))
        self.assertEqual(employee.work_hours, Decimal("8"))

        update_response = self.client.patch(
            f"/api/users/{self.admin.id}/",
            data=json.dumps({"username": "owner", "password": "newpass123"}),
            content_type="application/json",
        )

        self.assertEqual(update_response.status_code, 200)
        payload = update_response.json()["user"]
        self.assertTrue(payload["isDefaultAdmin"])
        self.assertTrue(payload["isProtectedAdmin"])
        self.admin.refresh_from_db()
        self.assertEqual(self.admin.username, "owner")
        self.assertTrue(self.admin.check_password("newpass123"))

        self.client.logout()
        login_response = self.client.post(
            "/api/auth/login/",
            data={"username": "owner", "password": "newpass123"},
            content_type="application/json",
        )
        self.assertEqual(login_response.status_code, 200)

    def test_non_default_admin_can_be_managed_like_staff(self):
        manager = User.objects.create_user(username="manager", password="secret123", first_name="Manager", is_staff=True)
        UserProfile.objects.create(user=manager, role="admin", permissions={})

        response = self.client.patch(
            f"/api/users/{manager.id}/",
            data=json.dumps({
                "name": "Manager Staff",
                "role": "cashier",
                "permissions": {"sales.open": True},
                "salary": "500000",
                "workHours": "6",
            }),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        manager.refresh_from_db()
        profile = UserProfile.objects.get(user=manager)
        employee = Employee.objects.get(user=manager)
        self.assertEqual(profile.role, "cashier")
        self.assertEqual(profile.permissions, {"sales.open": True})
        self.assertEqual(employee.salary, Decimal("500000"))
        self.assertEqual(employee.work_hours, Decimal("6"))

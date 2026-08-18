import logging

import desktop_config


desktop_config.ensure_runtime_dirs()

LOG_FILE = desktop_config.LOG_DIR / "server.log"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(),
    ],
)


def info(message, *args, **kwargs):
    logging.info(message, *args, **kwargs)


def warning(message, *args, **kwargs):
    logging.warning(message, *args, **kwargs)


def error(message, *args, **kwargs):
    logging.error(message, *args, **kwargs)


def exception(message, *args, **kwargs):
    logging.exception(message, *args, **kwargs)

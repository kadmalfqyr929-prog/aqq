(function () {
  function dataUrlToFile(dataUrl, filename) {
    const parts = String(dataUrl || "").split(",");
    const meta = parts[0] || "";
    const mime = (meta.match(/data:([^;]+)/) || [])[1] || "image/webp";
    const binary = atob(parts[1] || "");
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new File([bytes], filename, { type: mime });
  }

  function safeImageName(file, suffix) {
    const base = String(file?.name || "product-image").replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "-").slice(0, 60) || "product-image";
    return `${base}-${suffix}.webp`;
  }

  function compressProductImage(file, options = {}) {
    return new Promise((resolve, reject) => {
      if (!file) {
        resolve("");
        return;
      }

      const maxOriginalBytes = options.maxOriginalBytes || 10 * 1024 * 1024;
      const maxStoredChars = options.maxStoredChars || 620 * 1024;
      if (file.size > maxOriginalBytes) {
        reject(new Error("IMAGE_TOO_LARGE"));
        return;
      }
      if (!/^image\//.test(file.type || "")) {
        reject(new Error("INVALID_IMAGE"));
        return;
      }

      const renderDataUrl = (image, maxSide, quality, type = "image/webp") => {
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        if (type === "image/jpeg") {
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, canvas.width, canvas.height);
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL(type, quality);
        if (type === "image/webp" && !dataUrl.startsWith("data:image/webp")) {
          return canvas.toDataURL("image/jpeg", quality);
        }
        return dataUrl;
      };

      const reader = new FileReader();
      reader.onerror = () => reject(new Error("IMAGE_READ_FAILED"));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error("IMAGE_LOAD_FAILED"));
        image.onload = () => {
          const maxSide = Number(options.maxSide || 1100);
          const quality = Number(options.quality || 0.9);
          let dataUrl = renderDataUrl(image, maxSide, quality);
          if (dataUrl.length > maxStoredChars) dataUrl = renderDataUrl(image, Math.min(maxSide, 960), Math.min(quality, 0.86));
          if (dataUrl.length > maxStoredChars) dataUrl = renderDataUrl(image, Math.min(maxSide, 820), Math.min(quality, 0.8));
          if (dataUrl.length > maxStoredChars) dataUrl = renderDataUrl(image, Math.min(maxSide, 680), Math.min(quality, 0.72));
          if (dataUrl.length > maxStoredChars) dataUrl = renderDataUrl(image, Math.min(maxSide, 560), Math.min(quality, 0.66));
          if (dataUrl.length > maxStoredChars) dataUrl = renderDataUrl(image, Math.min(maxSide, 520), Math.min(quality, 0.62), "image/jpeg");
          if (dataUrl.length > maxStoredChars) {
            reject(new Error("IMAGE_COMPRESSED_TOO_LARGE"));
            return;
          }
          resolve(dataUrl);
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function prepareProductImage(file) {
    const preview = await compressProductImage(file, { maxSide: 900, maxStoredChars: 420 * 1024, quality: 0.86 });
    const large = await compressProductImage(file, { maxSide: 1400, maxStoredChars: 680 * 1024, quality: 0.9 });
    const catalog = await compressProductImage(file, { maxSide: 760, maxStoredChars: 260 * 1024, quality: 0.82 });
    const thumb = await compressProductImage(file, { maxSide: 260, maxStoredChars: 96 * 1024, quality: 0.76 });
    return {
      id: `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: file?.name || "",
      preview,
      files: {
        original: dataUrlToFile(preview, safeImageName(file, "original")),
        large: dataUrlToFile(large, safeImageName(file, "large")),
        catalog: dataUrlToFile(catalog, safeImageName(file, "catalog")),
        thumb: dataUrlToFile(thumb, safeImageName(file, "thumb"))
      }
    };
  }

  window.ToxMedia = {
    ...(window.ToxMedia || {}),
    compressProductImage,
    prepareProductImage
  };
})();

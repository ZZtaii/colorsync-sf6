(() => {
    const images = [...document.querySelectorAll(".release-visual img, .screenshot-slot img")];
    if (!images.length || typeof HTMLDialogElement === "undefined") return;

    const dialog = document.createElement("dialog");
    dialog.className = "image-lightbox";
    dialog.setAttribute("aria-label", "Expanded screenshot");

    const expandedImage = document.createElement("img");
    expandedImage.className = "image-lightbox-image";

    const closeButton = document.createElement("button");
    closeButton.className = "image-lightbox-close";
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "Close expanded image");
    closeButton.innerHTML = `
        <svg viewBox="0 0 32 32" aria-hidden="true">
            <path d="M8 8l16 16M24 8L8 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
        </svg>`;

    dialog.append(expandedImage, closeButton);
    document.body.append(dialog);

    let openingImage = null;

    function openLightbox(image) {
        openingImage = image;
        expandedImage.src = image.currentSrc || image.src;
        expandedImage.alt = image.alt;
        document.body.classList.add("image-lightbox-open");
        dialog.showModal();
        closeButton.focus();
    }

    function closeLightbox() {
        if (dialog.open) dialog.close();
    }

    images.forEach((image) => {
        const figure = image.closest("figure");
        if (figure) {
            figure.classList.add("lightbox-trigger");
            const expandIcon = document.createElement("span");
            expandIcon.className = "lightbox-expand-icon";
            expandIcon.setAttribute("aria-hidden", "true");
            expandIcon.innerHTML = `
                <svg viewBox="0 0 32 32">
                    <path d="M13 5H5v8M19 5h8v8M27 19v8h-8M13 27H5v-8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
                </svg>`;
            figure.append(expandIcon);
        }

        image.classList.add("lightbox-enabled");
        image.tabIndex = 0;
        image.setAttribute("role", "button");
        image.setAttribute("aria-haspopup", "dialog");
        image.setAttribute("aria-label", `Enlarge image: ${image.alt || "screenshot"}`);

        image.addEventListener("click", () => openLightbox(image));
        image.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            openLightbox(image);
        });
    });

    closeButton.addEventListener("click", closeLightbox);
    dialog.addEventListener("click", (event) => {
        if (event.target === dialog) closeLightbox();
    });
    dialog.addEventListener("close", () => {
        document.body.classList.remove("image-lightbox-open");
        expandedImage.removeAttribute("src");
        openingImage?.focus();
        openingImage = null;
    });
})();

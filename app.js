// Initialize PDF.js
const pdfjsLib = window['pdfjs-dist/build/pdf'];
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Application State
let pdfDoc = null;
let pdfFileName = '';
let currentPage = 1;
let totalPages = 1;
let zoomScale = 1.0;
let exportScale = 3.0;

// Coordinates are percentages (0 to 100)
let verticalLines = [20, 40, 60, 80]; 
let horizontalSplits = [[], [], [], [], []]; // 5 columns (index 0 to 4)
let crops = []; // List of cropped image objects

// DOM Elements
const dropzone = document.getElementById('dropzone');
const browseBtn = document.getElementById('browseBtn');
const pdfFileInput = document.getElementById('pdfFileInput');
const uploadPanel = document.getElementById('uploadPanel');
const editorControls = document.getElementById('editorControls');
const pdfFileNameEl = document.getElementById('pdfFileName');
const pdfPageCountEl = document.getElementById('pdfPageCount');
const currentPageNumEl = document.getElementById('currentPageNum');
const totalPagesNumEl = document.getElementById('totalPagesNum');
const prevPageBtn = document.getElementById('prevPageBtn');
const nextPageBtn = document.getElementById('nextPageBtn');
const resetGuidesBtn = document.getElementById('resetGuidesBtn');

const workspaceEmpty = document.getElementById('workspaceEmpty');
const workspaceLoader = document.getElementById('workspaceLoader');
const loaderMessage = document.getElementById('loaderMessage');
const editorInterface = document.getElementById('editorInterface');
const viewport = document.getElementById('viewport');
const canvasContainer = document.getElementById('canvasContainer');
const pdfDisplayCanvas = document.getElementById('pdfDisplayCanvas');
const pdfExportCanvas = document.getElementById('pdfExportCanvas');
const interactiveOverlay = document.getElementById('interactiveOverlay');

const hPreviewLine = document.getElementById('hPreviewLine');
const splitsContainer = document.getElementById('splitsContainer');
const segmentsContainer = document.getElementById('segmentsContainer');

const previewOverlay = document.getElementById('previewOverlay');
const previewGrid = document.getElementById('previewGrid');
const cropCountText = document.getElementById('cropCountText');
const backToEditorBtn = document.getElementById('backToEditorBtn');
const downloadZipBtn = document.getElementById('downloadZipBtn');
const clearAllCropsBtn = document.getElementById('clearAllCropsBtn');
const generateCropsBtn = document.getElementById('generateCropsBtn');

const baseFileNameInput = document.getElementById('baseFileNameInput');
const autoNumberToggle = document.getElementById('autoNumberToggle');
const startNumberInput = document.getElementById('startNumberInput');
const mergeSelectedBtn = document.getElementById('mergeSelectedBtn');

const zoomOutBtn = document.getElementById('zoomOutBtn');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomResetBtn = document.getElementById('zoomResetBtn');
const zoomDisplayVal = document.getElementById('zoomDisplayVal');

// Initialize Icons
lucide.createIcons();

// --- File Upload Handlers ---

// Trigger file input dialog
browseBtn.addEventListener('click', () => pdfFileInput.click());
dropzone.addEventListener('click', (e) => {
    if (e.target !== browseBtn && !browseBtn.contains(e.target)) {
        pdfFileInput.click();
    }
});

// Drag & Drop effects
dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
});

dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
});

dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].type === 'application/pdf') {
        loadPDF(files[0]);
    } else {
        alert('Please upload a valid PDF file.');
    }
});

pdfFileInput.addEventListener('change', (e) => {
    const files = e.target.files;
    if (files.length > 0) {
        loadPDF(files[0]);
    }
});

// Load PDF Document
function loadPDF(file) {
    pdfFileName = file.name;
    pdfFileNameEl.textContent = pdfFileName;
    
    showLoader('Reading PDF file...');
    
    const fileReader = new FileReader();
    fileReader.onload = function() {
        const typedarray = new Uint8Array(this.result);
        
        pdfjsLib.getDocument(typedarray).promise.then(function(pdf) {
            pdfDoc = pdf;
            totalPages = pdf.numPages;
            pdfPageCountEl.textContent = totalPages;
            totalPagesNumEl.textContent = totalPages;
            currentPage = 1;
            currentPageNumEl.textContent = currentPage;
            
            // Reset state
            resetState();
            
            // Pre-fill base filename input
            if (baseFileNameInput) {
                baseFileNameInput.value = file.name.replace('.pdf', '').replace(/\s+/g, '_');
            }
            
            // Show editor sidebar
            uploadPanel.style.display = 'none';
            editorControls.style.display = 'flex';
            workspaceEmpty.style.display = 'none';
            editorInterface.style.display = 'flex';
            
            renderCurrentPage();
        }).catch(function(err) {
            hideLoader();
            alert('Error loading PDF: ' + err.message);
        });
    };
    fileReader.readAsArrayBuffer(file);
}

function resetState() {
    verticalLines = [20, 40, 60, 80];
    horizontalSplits = [[], [], [], [], []];
    crops = [];
    zoomScale = 1.0;
    updateZoomDisplay();
    updateCoordinateLabels();
}

function updateZoomDisplay() {
    if (zoomDisplayVal) {
        zoomDisplayVal.textContent = `${Math.round(zoomScale * 100)}%`;
    }
}

function showLoader(msg) {
    loaderMessage.textContent = msg;
    workspaceLoader.style.display = 'flex';
}

function hideLoader() {
    workspaceLoader.style.display = 'none';
}

// --- PDF Rendering ---

function renderCurrentPage() {
    if (!pdfDoc) return;
    
    showLoader(`Rendering page ${currentPage}...`);
    
    pdfDoc.getPage(currentPage).then(function(page) {
        // Compute responsive scale to fit workspace
        const workspaceRect = document.querySelector('.workspace').getBoundingClientRect();
        const padding = 60; // 30px padding on each side
        const maxWidth = workspaceRect.width - padding;
        const maxHeight = workspaceRect.height - padding;
        
        const unscaledViewport = page.getViewport({ scale: 1.0 });
        const scaleX = maxWidth / unscaledViewport.width;
        const scaleY = maxHeight / unscaledViewport.height;
        const baseScale = Math.min(scaleX, scaleY);
        const displayScale = baseScale * zoomScale;
        
        const displayViewport = page.getViewport({ scale: displayScale });
        
        // 1. Render display canvas
        pdfDisplayCanvas.width = displayViewport.width;
        pdfDisplayCanvas.height = displayViewport.height;
        
        // Set dimensions on container so overlay matches perfectly
        canvasContainer.style.width = displayViewport.width + 'px';
        canvasContainer.style.height = displayViewport.height + 'px';
        
        const renderContext = {
            canvasContext: pdfDisplayCanvas.getContext('2d'),
            viewport: displayViewport
        };
        
        const displayRenderPromise = page.render(renderContext).promise;
        
        Promise.all([displayRenderPromise]).then(() => {
            hideLoader();
            setupInteractiveOverlay();
        }).catch(err => {
            hideLoader();
            console.error('Render error:', err);
        });
        
    });
}

// --- Interactive Guides Setup ---

function setupInteractiveOverlay() {
    // Position vertical guide lines
    updateVerticalGuides();
    renderHorizontalSplits();
    renderSegments();
}

function updateVerticalGuides() {
    verticalLines.forEach((pct, idx) => {
        const guideEl = document.getElementById(`guideV${idx}`);
        guideEl.style.left = `${pct}%`;
        
        const coordLabel = document.getElementById(`coordVal${idx}`);
        coordLabel.textContent = `${Math.round(pct)}%`;
    });
}

function updateCoordinateLabels() {
    verticalLines.forEach((pct, idx) => {
        const coordLabel = document.getElementById(`coordVal${idx}`);
        if (coordLabel) coordLabel.textContent = `${Math.round(pct)}%`;
    });
}

// Draw user horizontal split lines
function renderHorizontalSplits() {
    splitsContainer.innerHTML = '';
    
    horizontalSplits.forEach((splitsList, colIdx) => {
        const colStartX = colIdx === 0 ? 0 : verticalLines[colIdx - 1];
        const colEndX = colIdx === 4 ? 100 : verticalLines[colIdx];
        const colWidth = colEndX - colStartX;
        
        splitsList.forEach((yPct) => {
            const splitWrapper = document.createElement('div');
            splitWrapper.className = 'split-line-wrapper';
            splitWrapper.style.left = `${colStartX}%`;
            splitWrapper.style.width = `${colWidth}%`;
            splitWrapper.style.top = `${yPct}%`;
            
            // Visual split line
            const splitLine = document.createElement('div');
            splitLine.className = 'split-line';
            
            // Delete button
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-line-btn';
            deleteBtn.innerHTML = '×';
            deleteBtn.title = 'Double click line or click this button to delete';
            
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                removeSplitLine(colIdx, yPct);
            });
            
            splitWrapper.appendChild(splitLine);
            splitWrapper.appendChild(deleteBtn);
            
            // Double click to delete
            splitWrapper.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                removeSplitLine(colIdx, yPct);
            });
            
            splitsContainer.appendChild(splitWrapper);
        });
    });
}

// Highlight the actual crop boxes
function renderSegments() {
    segmentsContainer.innerHTML = '';
    
    horizontalSplits.forEach((splitsList, colIdx) => {
        const colStartX = colIdx === 0 ? 0 : verticalLines[colIdx - 1];
        const colEndX = colIdx === 4 ? 100 : verticalLines[colIdx];
        const colWidth = colEndX - colStartX;
        
        // We only render segments between consecutive splits!
        for (let i = 0; i < splitsList.length - 1; i++) {
            const yTop = splitsList[i];
            const yBottom = splitsList[i+1];
            const height = yBottom - yTop;
            
            // Don't render empty segments
            if (height <= 0.5) continue;
            
            const segment = document.createElement('div');
            segment.className = 'crop-segment';
            segment.style.left = `${colStartX}%`;
            segment.style.width = `${colWidth}%`;
            segment.style.top = `${yTop}%`;
            segment.style.height = `${height}%`;
            
            segment.title = `Col ${colIdx + 1}, Crop ${i + 1}`;
            
            segmentsContainer.appendChild(segment);
        }
    });
}

function removeSplitLine(colIdx, yPct) {
    horizontalSplits[colIdx] = horizontalSplits[colIdx].filter(y => y !== yPct);
    renderHorizontalSplits();
    renderSegments();
}

// --- Dragging Vertical Lines ---

let draggingIdx = null;

// Attach listeners to vertical guidelines
document.querySelectorAll('.guide-vertical').forEach(guide => {
    guide.addEventListener('mousedown', (e) => {
        e.preventDefault();
        draggingIdx = parseInt(guide.dataset.index);
        guide.classList.add('dragging');
    });
});

document.addEventListener('mousemove', (e) => {
    if (draggingIdx === null) {
        // Handle horizontal line split preview on hover
        handleSplitPreview(e);
        return;
    }
    
    const overlayRect = interactiveOverlay.getBoundingClientRect();
    let dragX = e.clientX - overlayRect.left;
    let dragPct = (dragX / overlayRect.width) * 100;
    
    // Bounds constraints
    const minPct = draggingIdx === 0 ? 2 : verticalLines[draggingIdx - 1] + 2;
    const maxPct = draggingIdx === 3 ? 98 : verticalLines[draggingIdx + 1] - 2;
    
    dragPct = Math.max(minPct, Math.min(maxPct, dragPct));
    
    verticalLines[draggingIdx] = dragPct;
    updateVerticalGuides();
    renderHorizontalSplits(); // Update lengths of horizontal splits
    renderSegments();         // Update highlights
});

document.addEventListener('mouseup', () => {
    if (draggingIdx !== null) {
        const guideEl = document.getElementById(`guideV${draggingIdx}`);
        if (guideEl) guideEl.classList.remove('dragging');
        draggingIdx = null;
    }
});

// --- Split Preview & Clicking on Canvas ---

function handleSplitPreview(e) {
    if (!pdfDoc || draggingIdx !== null) return;
    
    const overlayRect = interactiveOverlay.getBoundingClientRect();
    const mouseX = e.clientX - overlayRect.left;
    const mouseY = e.clientY - overlayRect.top;
    
    // Ensure mouse is inside overlay
    if (mouseX < 0 || mouseX > overlayRect.width || mouseY < 0 || mouseY > overlayRect.height) {
        hPreviewLine.style.display = 'none';
        return;
    }
    
    const mouseXPct = (mouseX / overlayRect.width) * 100;
    const colIdx = getColumnIndex(mouseXPct);
    
    const colStartX = colIdx === 0 ? 0 : verticalLines[colIdx - 1];
    const colEndX = colIdx === 4 ? 100 : verticalLines[colIdx];
    
    hPreviewLine.style.left = `${colStartX}%`;
    hPreviewLine.style.width = `${colEndX - colStartX}%`;
    hPreviewLine.style.top = `${mouseY}px`;
    hPreviewLine.style.display = 'block';
}

function getColumnIndex(xPct) {
    if (xPct < verticalLines[0]) return 0;
    if (xPct < verticalLines[1]) return 1;
    if (xPct < verticalLines[2]) return 2;
    if (xPct < verticalLines[3]) return 3;
    return 4;
}

// Add split on click
interactiveOverlay.addEventListener('click', (e) => {
    // If clicked on handle or delete button, skip
    if (e.target.closest('.guide-handle') || e.target.closest('.delete-line-btn') || e.target.closest('.guide-vertical')) {
        return;
    }
    
    const overlayRect = interactiveOverlay.getBoundingClientRect();
    const mouseX = e.clientX - overlayRect.left;
    const mouseY = e.clientY - overlayRect.top;
    
    const xPct = (mouseX / overlayRect.width) * 100;
    const yPct = (mouseY / overlayRect.height) * 100;
    
    const colIdx = getColumnIndex(xPct);
    
    // Prevent adding splits too close to top/bottom or other splits
    const existing = horizontalSplits[colIdx];
    const tooClose = existing.some(y => Math.abs(y - yPct) < 1.0) || yPct < 1.0 || yPct > 99.0;
    
    if (!tooClose) {
        horizontalSplits[colIdx].push(yPct);
        horizontalSplits[colIdx].sort((a, b) => a - b);
        renderHorizontalSplits();
        renderSegments();
    }
});

// Reset guides button
resetGuidesBtn.addEventListener('click', () => {
    resetState();
    updateVerticalGuides();
    renderHorizontalSplits();
    renderSegments();
});

// --- Page Navigation ---

prevPageBtn.addEventListener('click', () => {
    if (currentPage > 1) {
        currentPage--;
        currentPageNumEl.textContent = currentPage;
        // Keep lines layout but clean splits for new page?
        // Let's clear horizontal splits because each page has different content, 
        // but keep vertical guides as they usually align to columns on all pages.
        horizontalSplits = [[], [], [], [], []];
        renderCurrentPage();
    }
});

nextPageBtn.addEventListener('click', () => {
    if (currentPage < totalPages) {
        currentPage++;
        currentPageNumEl.textContent = currentPage;
        horizontalSplits = [[], [], [], [], []];
        renderCurrentPage();
    }
});

// --- Crop Generation & Export ---

generateCropsBtn.addEventListener('click', () => {
    if (!pdfDoc) return;
    
    showLoader('Cropping and rendering high-quality PNGs...');
    
    // Wait a brief moment to allow UI to render loader
    setTimeout(() => {
        generateCrops();
    }, 100);
});

function generateCrops() {
    if (!pdfDoc) return;
    
    showLoader('Rendering high-resolution export canvas...');
    
    pdfDoc.getPage(currentPage).then(function(page) {
        const exportViewport = page.getViewport({ scale: exportScale });
        pdfExportCanvas.width = exportViewport.width;
        pdfExportCanvas.height = exportViewport.height;
        
        const exportCtx = pdfExportCanvas.getContext('2d');
        const exportRenderContext = {
            canvasContext: exportCtx,
            viewport: exportViewport
        };
        
        page.render(exportRenderContext).promise.then(() => {
            showLoader('Cropping and rendering PNGs...');
            
            const exportW = pdfExportCanvas.width;
            const exportH = pdfExportCanvas.height;
            crops = [];
            
            const baseNamePrefix = baseFileNameInput.value.trim();
            const autoNumber = autoNumberToggle.checked;
            const startNum = parseInt(startNumberInput.value) || 1;
            let cropCounter = startNum;
            
            horizontalSplits.forEach((splitsList, colIdx) => {
                const colStartX = colIdx === 0 ? 0 : verticalLines[colIdx - 1];
                const colEndX = colIdx === 4 ? 100 : verticalLines[colIdx];
                
                // Only loop over splitsList (we only crop between user split lines)
                for (let i = 0; i < splitsList.length - 1; i++) {
                    const yTop = splitsList[i];
                    const yBottom = splitsList[i+1];
                    const height = yBottom - yTop;
                    
                    // Skip empty/tiny segments
                    if (height <= 0.5) continue;
                    
                    // Calculate absolute pixel coordinates on the high-res export canvas
                    const cropX = Math.round((colStartX / 100) * exportW);
                    const cropWidth = Math.round(((colEndX - colStartX) / 100) * exportW);
                    const cropY = Math.round((yTop / 100) * exportH);
                    const cropHeight = Math.round((height / 100) * exportH);
                    
                    // Check bounding boxes are valid
                    if (cropWidth <= 0 || cropHeight <= 0) continue;
                    
                    // Create a temp canvas to hold the cropped image
                    const cropCanvas = document.createElement('canvas');
                    cropCanvas.width = cropWidth;
                    cropCanvas.height = cropHeight;
                    const cropCtx = cropCanvas.getContext('2d');
                    
                    // Crop from export canvas
                    cropCtx.drawImage(
                        pdfExportCanvas,
                        cropX, cropY, cropWidth, cropHeight, // Source bounds
                        0, 0, cropWidth, cropHeight          // Destination bounds
                    );
                    
                    const dataUrl = cropCanvas.toDataURL('image/png');
                    
                    // Determine filename
                    let cropName = '';
                    if (autoNumber) {
                        const paddedCounter = String(cropCounter).padStart(Math.max(2, String(startNum).length), '0');
                        cropName = `${baseNamePrefix || 'sol'}${paddedCounter}.png`;
                        cropCounter++;
                    } else {
                        const defaultBase = baseNamePrefix || pdfFileName.replace('.pdf', '').replace(/\s+/g, '_');
                        cropName = `${defaultBase}_p${currentPage}_col${colIdx + 1}_row${i + 1}.png`;
                    }
                    
                    crops.push({
                        id: `crop_${colIdx}_${i}_${Date.now()}`,
                        name: cropName,
                        dataUrl: dataUrl,
                        width: cropWidth,
                        height: cropHeight
                      });
                  }
              });
              
              hideLoader();
              showPreviewModal();
          }).catch(err => {
              hideLoader();
              alert('Error rendering export PDF: ' + err.message);
          });
      }).catch(err => {
          hideLoader();
          alert('Error loading PDF page: ' + err.message);
      });
  }

// --- Preview Modal UI Handling ---

function showPreviewModal() {
    previewOverlay.style.display = 'flex';
    renderPreviewGrid();
}

function renderPreviewGrid() {
    previewGrid.innerHTML = '';
    cropCountText.textContent = crops.length;
    
    // Reset merge button state
    if (mergeSelectedBtn) mergeSelectedBtn.disabled = true;
    
    if (crops.length === 0) {
        previewGrid.innerHTML = `
            <div class="empty-state-content" style="grid-column: 1/-1; margin: 60px auto;">
                <i data-lucide="image-off" style="width: 48px; height: 48px; color: var(--text-muted);"></i>
                <h3>No screenshots generated</h3>
                <p>Go back and add split lines in the columns.</p>
            </div>
        `;
        lucide.createIcons({ attrs: { class: 'lucide-icon' } });
        return;
    }
    
    crops.forEach((crop) => {
        const card = document.createElement('div');
        card.className = 'crop-card';
        card.dataset.id = crop.id;
        
        card.innerHTML = `
            <div class="crop-card-select">
                <input type="checkbox" class="crop-select-cb" data-id="${crop.id}" title="Select for merging">
            </div>
            <div class="crop-img-container">
                <img src="${crop.dataUrl}" alt="${crop.name}">
            </div>
            <div class="crop-details">
                <div class="crop-meta">
                    <input type="text" class="crop-name-input" value="${crop.name}" title="Click to rename manually">
                    <span class="crop-size">${crop.width} × ${crop.height} px</span>
                </div>
                <div class="crop-card-actions">
                    <button class="btn btn-secondary btn-xs btn-download-single">
                        <i data-lucide="download"></i> Download
                    </button>
                    <button class="btn btn-danger btn-xs btn-delete-single">
                        <i data-lucide="trash-2"></i> Delete
                    </button>
                </div>
            </div>
        `;
        
        // Single Download action
        card.querySelector('.btn-download-single').addEventListener('click', () => {
            downloadSingleCrop(crop);
        });
        
        // Single Delete action
        card.querySelector('.btn-delete-single').addEventListener('click', () => {
            removeSingleCrop(crop.id);
        });
        
        // Manual rename action
        card.querySelector('.crop-name-input').addEventListener('input', (e) => {
            crop.name = e.target.value;
        });
        
        // Checkbox toggle action
        card.querySelector('.crop-select-cb').addEventListener('change', () => {
            updateMergeButtonState();
        });
        
        previewGrid.appendChild(card);
    });
    
    // Refresh icons inside cards
    lucide.createIcons();
}

function updateMergeButtonState() {
    if (!mergeSelectedBtn) return;
    const selectedCount = document.querySelectorAll('.crop-select-cb:checked').length;
    mergeSelectedBtn.disabled = selectedCount < 2;
}

function downloadSingleCrop(crop) {
    // Reverting back to Data URL for single crops. Data URLs do not use object URLs,
    // so they are immune to the UUID/GUID filename replacement bug in Chromium.
    const a = document.createElement('a');
    a.href = crop.dataUrl;
    a.download = crop.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function removeSingleCrop(id) {
    crops = crops.filter(c => c.id !== id);
    
    // Auto-renumber remaining crops if auto-number is enabled
    const autoNumber = autoNumberToggle.checked;
    if (autoNumber) {
        const baseNamePrefix = baseFileNameInput.value.trim() || 'sol';
        const startNum = parseInt(startNumberInput.value) || 1;
        crops.forEach((crop, idx) => {
            const paddedCounter = String(startNum + idx).padStart(Math.max(2, String(startNum).length), '0');
            crop.name = `${baseNamePrefix}${paddedCounter}.png`;
        });
    }
    
    renderPreviewGrid();
}

// Clear all crops in preview
clearAllCropsBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to discard all crops?')) {
        crops = [];
        renderPreviewGrid();
    }
});

// Close Preview Overlay
backToEditorBtn.addEventListener('click', () => {
    previewOverlay.style.display = 'none';
});

// Merge Selected Crops Vertically
mergeSelectedBtn.addEventListener('click', () => {
    const selectedCheckboxes = document.querySelectorAll('.crop-select-cb:checked');
    if (selectedCheckboxes.length < 2) return;
    
    const selectedIds = new Set(Array.from(selectedCheckboxes).map(cb => cb.dataset.id));
    const selectedCrops = crops.filter(c => selectedIds.has(c.id));
    
    stitchSelectedCrops(selectedCrops);
});

async function stitchSelectedCrops(selectedCrops) {
    showLoader('Stitching selected crops vertically...');
    
    try {
        const imagePromises = selectedCrops.map(crop => {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve({ img, crop });
                img.onerror = () => reject(new Error('Failed to load image: ' + crop.name));
                img.src = crop.dataUrl;
            });
        });
        
        const loadedImages = await Promise.all(imagePromises);
        
        // Find dimensions of canvas
        const maxWidth = Math.max(...loadedImages.map(item => item.crop.width));
        const totalHeight = loadedImages.reduce((sum, item) => sum + item.crop.height, 0);
        
        const canvas = document.createElement('canvas');
        canvas.width = maxWidth;
        canvas.height = totalHeight;
        const ctx = canvas.getContext('2d');
        
        // White canvas background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, maxWidth, totalHeight);
        
        let currentY = 0;
        loadedImages.forEach(item => {
            // Draw image centered horizontally
            const xOffset = Math.round((maxWidth - item.crop.width) / 2);
            ctx.drawImage(item.img, xOffset, currentY);
            currentY += item.crop.height;
        });
        
        const mergedDataUrl = canvas.toDataURL('image/png');
        
        const baseNamePrefix = baseFileNameInput.value.trim() || 'sol';
        const startNum = parseInt(startNumberInput.value) || 1;
        
        // Generate helpful merged filename: Merged_sol01_sol02.png
        const namesInfo = selectedCrops.map(c => c.name.replace('.png', '').replace(baseNamePrefix, '')).join('_');
        const mergedName = `Merged_${baseNamePrefix}${namesInfo}.png`;
        
        const newCrop = {
            id: `crop_merged_${Date.now()}`,
            name: mergedName,
            dataUrl: mergedDataUrl,
            width: maxWidth,
            height: totalHeight
        };
        
        // Insert new crop at the index of the first selected crop
        const firstSelectedId = selectedCrops[0].id;
        const firstIndex = crops.findIndex(c => c.id === firstSelectedId);
        
        // Remove the stitched crops from the original array
        const selectedIds = new Set(selectedCrops.map(c => c.id));
        crops = crops.filter(c => !selectedIds.has(c.id));
        
        // Insert the merged one
        crops.splice(firstIndex, 0, newCrop);
        
        // Re-number remaining crops if auto-numbering is enabled
        const autoNumber = autoNumberToggle.checked;
        if (autoNumber) {
            crops.forEach((crop, idx) => {
                const paddedCounter = String(startNum + idx).padStart(Math.max(2, String(startNum).length), '0');
                crop.name = `${baseNamePrefix}${paddedCounter}.png`;
            });
        }
        
        hideLoader();
        renderPreviewGrid();
    } catch (err) {
        hideLoader();
        alert('Stitching failed: ' + err.message);
    }
}

// Download All (ZIP)
downloadZipBtn.addEventListener('click', () => {
    if (crops.length === 0) {
        alert('There are no screenshots to download.');
        return;
    }
    
    const baseName = (pdfFileName || 'document').replace('.pdf', '');

    // Fallback if JSZip is blocked or fails to load (offline usage)
    if (typeof JSZip === 'undefined') {
        alert('ZIP library is not loaded. Downloading screenshots individually instead...');
        crops.forEach((crop, idx) => {
            setTimeout(() => {
                downloadSingleCrop(crop);
            }, idx * 400); // 400ms delay to prevent browser blocking multiple simultaneous downloads
        });
        return;
    }
    
    showLoader('Creating ZIP file...');
    
    try {
        const zip = new JSZip();
        
        crops.forEach((crop) => {
            const parts = crop.dataUrl.split(',');
            if (parts.length > 1) {
                const base64Data = parts[1];
                zip.file(crop.name, base64Data, { base64: true });
            }
        });
        
        zip.generateAsync({ type: 'blob' }).then(function(content) {
            hideLoader();
            const a = document.createElement('a');
            const url = URL.createObjectURL(content);
            a.href = url;
            a.download = `${baseName}_screenshots.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            // Delay revoking the Object URL for 30 seconds to guarantee the browser completes downloading it
            setTimeout(() => {
                URL.revokeObjectURL(url);
            }, 30000);
        }).catch(err => {
            hideLoader();
            alert('Error creating ZIP: ' + err.message);
        });
    } catch (e) {
        hideLoader();
        alert('Error preparing ZIP file: ' + e.message);
    }
});

// --- Zoom Controls ---
zoomInBtn.addEventListener('click', () => {
    if (zoomScale < 4.0) {
        zoomScale = Math.min(zoomScale + 0.15, 4.0);
        updateZoomDisplay();
        renderCurrentPage();
    }
});

zoomOutBtn.addEventListener('click', () => {
    if (zoomScale > 0.5) {
        zoomScale = Math.max(zoomScale - 0.15, 0.5);
        updateZoomDisplay();
        renderCurrentPage();
    }
});

zoomResetBtn.addEventListener('click', () => {
    if (zoomScale !== 1.0) {
        zoomScale = 1.0;
        updateZoomDisplay();
        renderCurrentPage();
    }
});

// --- Quality Selector Controls ---
document.querySelectorAll('.quality-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.quality-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        exportScale = parseFloat(btn.dataset.scale);
    });
});

// --- Mouse Wheel Zoom Control (Ctrl + Wheel) ---
interactiveOverlay.addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
        e.preventDefault();
        
        // Scroll Up -> Zoom In, Scroll Down -> Zoom Out
        if (e.deltaY < 0) {
            if (zoomScale < 4.0) {
                zoomScale = Math.min(zoomScale + 0.1, 4.0);
                updateZoomDisplay();
                renderCurrentPage();
            }
        } else {
            if (zoomScale > 0.5) {
                zoomScale = Math.max(zoomScale - 0.1, 0.5);
                updateZoomDisplay();
                renderCurrentPage();
            }
        }
    }
}, { passive: false });

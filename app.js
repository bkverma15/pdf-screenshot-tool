// Initialize PDF.js
const pdfjsLib = window['pdfjs-dist/build/pdf'];
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Application State
let pdfDoc = null;
let pdfFileName = '';
let currentPage = 1;
let totalPages = 1;
let zoomScale = 1.0;
let exportScale = 6.0;

// Coordinates are percentages (0 to 100)
let verticalLines = [20, 40, 60, 80]; 
let horizontalSplits = [[], [], [], [], []]; // 5 columns (index 0 to 4)
let crops = []; // List of cropped image objects

// History Stack (Undo/Redo)
let historyStack = [];
let redoStack = [];

// Layout Profiles
let profiles = {
    'default': [20, 40, 60, 80]
};

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
const downloadPdfBtn = document.getElementById('downloadPdfBtn');
const clearAllCropsBtn = document.getElementById('clearAllCropsBtn');
const generateCropsBtn = document.getElementById('generateCropsBtn');

const baseFileNameInput = document.getElementById('baseFileNameInput');
const autoNumberToggle = document.getElementById('autoNumberToggle');
const startNumberInput = document.getElementById('startNumberInput');
const mergeSelectedBtn = document.getElementById('mergeSelectedBtn');

const profileSelect = document.getElementById('profileSelect');
const saveProfileBtn = document.getElementById('saveProfileBtn');
const deleteProfileBtn = document.getElementById('deleteProfileBtn');

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
                baseFileNameInput.value = 'sol';
            }
            
            // Load saved session for this PDF
            loadSession();
            
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
    const activeColBtn = document.querySelector('.col-btn.active');
    const colCount = activeColBtn ? parseInt(activeColBtn.dataset.cols) : 5;
    
    if (colCount === 1) {
        verticalLines = [];
    } else if (colCount === 2) {
        verticalLines = [50];
    } else if (colCount === 3) {
        verticalLines = [33.3, 66.6];
    } else if (colCount === 4) {
        verticalLines = [25, 50, 75];
    } else {
        verticalLines = [20, 40, 60, 80];
    }
    
    horizontalSplits = Array.from({ length: colCount }, () => []);
    crops = [];
    zoomScale = 1.0;
    historyStack = [JSON.stringify(horizontalSplits)];
    redoStack = [];
    updateZoomDisplay();
    initVerticalGuides();
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
    initVerticalGuides();
    renderHorizontalSplits();
    renderSegments();
}

function initVerticalGuides() {
    if (!verticalGuidesContainer) return;
    verticalGuidesContainer.innerHTML = '';
    
    if (guideCoordinatesContainer) {
        guideCoordinatesContainer.innerHTML = '';
    }
    
    verticalLines.forEach((pct, idx) => {
        // 1. Create guide element
        const guide = document.createElement('div');
        guide.className = 'guide-vertical';
        guide.id = `guideV${idx}`;
        guide.dataset.index = idx;
        guide.style.left = `${pct}%`;
        
        guide.innerHTML = `
            <div class="guide-line"></div>
            <div class="guide-handle">⋮</div>
        `;
        
        // Drag handler
        guide.addEventListener('mousedown', (e) => {
            e.preventDefault();
            draggingIdx = idx;
            guide.classList.add('dragging');
        });
        
        verticalGuidesContainer.appendChild(guide);
        
        // 2. Create coordinate item
        if (guideCoordinatesContainer) {
            const item = document.createElement('div');
            item.className = 'coord-item';
            item.innerHTML = `<span>Line ${idx + 1}</span><span id="coordVal${idx}">${Math.round(pct)}%</span>`;
            guideCoordinatesContainer.appendChild(item);
        }
    });
    
    // If single column, show message
    if (guideCoordinatesContainer && verticalLines.length === 0) {
        guideCoordinatesContainer.innerHTML = `<div class="single-col-msg" style="font-size:0.75rem; color:var(--text-muted); font-style:italic;">Single Column Mode (No vertical lines)</div>`;
    }
}

function updateVerticalGuides() {
    verticalLines.forEach((pct, idx) => {
        const guideEl = document.getElementById(`guideV${idx}`);
        if (guideEl) guideEl.style.left = `${pct}%`;
        
        const coordLabel = document.getElementById(`coordVal${idx}`);
        if (coordLabel) coordLabel.textContent = `${Math.round(pct)}%`;
    });
}

function updateCoordinateLabels() {
    updateVerticalGuides();
}

// Draw user horizontal split lines
function renderHorizontalSplits() {
    splitsContainer.innerHTML = '';
    
    horizontalSplits.forEach((splitsList, colIdx) => {
        const colStartX = colIdx === 0 ? 0 : verticalLines[colIdx - 1];
        const colEndX = colIdx === verticalLines.length ? 100 : verticalLines[colIdx];
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
            
            // Drag split line event listener
            splitWrapper.addEventListener('mousedown', (e) => {
                if (e.target.closest('.delete-line-btn')) return;
                e.preventDefault();
                e.stopPropagation();
                
                const overlayRect = interactiveOverlay.getBoundingClientRect();
                
                function onMouseMove(moveEvent) {
                    const currentY = moveEvent.clientY - overlayRect.top;
                    let newYPct = (currentY / overlayRect.height) * 100;
                    
                    // Constrain bounds
                    newYPct = Math.max(0.5, Math.min(99.5, newYPct));
                    
                    // Update value in array
                    const curIdx = horizontalSplits[colIdx].indexOf(yPct);
                    if (curIdx !== -1) {
                        horizontalSplits[colIdx][curIdx] = newYPct;
                        yPct = newYPct; // update local variable for next moves
                        
                        // Keep splits sorted
                        horizontalSplits[colIdx].sort((a, b) => a - b);
                        
                        // Update visual coordinates of this wrapper directly for performance
                        splitWrapper.style.top = `${newYPct}%`;
                        
                        renderSegments(); // Re-highlight crop segments in real-time
                    }
                }
                
                function onMouseUp() {
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                    
                    // Full render to clean up and sort
                    renderHorizontalSplits();
                    renderSegments();
                    pushHistory(); // Save action to history & local session
                }
                
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });
            
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
        const colEndX = colIdx === verticalLines.length ? 100 : verticalLines[colIdx];
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

let draggingIdx = null;

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
    const maxPct = draggingIdx === verticalLines.length - 1 ? 98 : verticalLines[draggingIdx + 1] - 2;
    
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
        saveSession();
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
        pushHistory();
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
        horizontalSplits = Array.from({ length: verticalLines.length + 1 }, () => []);
        historyStack = [JSON.stringify(horizontalSplits)];
        redoStack = [];
        renderCurrentPage();
        saveSession();
    }
});

nextPageBtn.addEventListener('click', () => {
    if (currentPage < totalPages) {
        currentPage++;
        currentPageNumEl.textContent = currentPage;
        horizontalSplits = Array.from({ length: verticalLines.length + 1 }, () => []);
        historyStack = [JSON.stringify(horizontalSplits)];
        redoStack = [];
        renderCurrentPage();
        saveSession();
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
                const colEndX = colIdx === verticalLines.length ? 100 : verticalLines[colIdx];
                
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

let draggedCardId = null;

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
        card.setAttribute('draggable', 'true');
        
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
        
        // Drag and Drop reordering events
        card.addEventListener('dragstart', (e) => {
            draggedCardId = crop.id;
            card.classList.add('dragging-card');
            e.dataTransfer.effectAllowed = 'move';
        });
        
        card.addEventListener('dragover', (e) => {
            e.preventDefault();
            card.classList.add('drag-over-card');
        });
        
        card.addEventListener('dragleave', () => {
            card.classList.remove('drag-over-card');
        });
        
        card.addEventListener('drop', (e) => {
            e.preventDefault();
            card.classList.remove('drag-over-card');
            
            if (draggedCardId && draggedCardId !== crop.id) {
                const dragIndex = crops.findIndex(c => c.id === draggedCardId);
                const targetIndex = crops.findIndex(c => c.id === crop.id);
                
                if (dragIndex !== -1 && targetIndex !== -1) {
                    const [movedCrop] = crops.splice(dragIndex, 1);
                    crops.splice(targetIndex, 0, movedCrop);
                    
                    // Re-number remaining crops if auto-number is enabled
                    const autoNumber = autoNumberToggle.checked;
                    if (autoNumber) {
                        const baseNamePrefix = baseFileNameInput.value.trim() || 'sol';
                        const startNum = parseInt(startNumberInput.value) || 1;
                        crops.forEach((c, idx) => {
                            const paddedCounter = String(startNum + idx).padStart(Math.max(2, String(startNum).length), '0');
                            c.name = `${baseNamePrefix}${paddedCounter}.png`;
                        });
                    }
                    
                    renderPreviewGrid();
                }
            }
        });
        
        card.addEventListener('dragend', () => {
            card.classList.remove('dragging-card');
            draggedCardId = null;
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
        saveSession();
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
                saveSession();
            }
        } else {
            if (zoomScale > 0.5) {
                zoomScale = Math.max(zoomScale - 0.1, 0.5);
                updateZoomDisplay();
                renderCurrentPage();
                saveSession();
            }
        }
    }
}, { passive: false });

// --- History & Session Persistence ---

function pushHistory() {
    const stateCopy = JSON.stringify(horizontalSplits);
    if (historyStack.length === 0 || historyStack[historyStack.length - 1] !== stateCopy) {
        historyStack.push(stateCopy);
        if (historyStack.length > 50) historyStack.shift();
        redoStack = [];
    }
    saveSession();
}

function undo() {
    if (historyStack.length > 1) {
        const currentState = historyStack.pop();
        redoStack.push(currentState);
        
        const previousState = historyStack[historyStack.length - 1];
        horizontalSplits = JSON.parse(previousState);
        
        renderHorizontalSplits();
        renderSegments();
        saveSession();
    } else if (historyStack.length === 1) {
        const currentState = historyStack.pop();
        redoStack.push(currentState);
        
        horizontalSplits = [[], [], [], [], []];
        renderHorizontalSplits();
        renderSegments();
        saveSession();
    }
}

function redo() {
    if (redoStack.length > 0) {
        const nextState = redoStack.pop();
        historyStack.push(nextState);
        
        horizontalSplits = JSON.parse(nextState);
        renderHorizontalSplits();
        renderSegments();
        saveSession();
    }
}

function saveSession() {
    if (!pdfFileName) return;
    const sessionData = {
        verticalLines,
        horizontalSplits,
        currentPage,
        zoomScale,
        exportScale,
        baseName: baseFileNameInput ? baseFileNameInput.value : '',
        startNumber: startNumberInput ? startNumberInput.value : '1',
        autoNumber: autoNumberToggle ? autoNumberToggle.checked : true,
        columnCount: verticalLines.length + 1
    };
    localStorage.setItem(`pdf_crop_session_${pdfFileName}`, JSON.stringify(sessionData));
}

function loadSession() {
    if (!pdfFileName) return;
    const saved = localStorage.getItem(`pdf_crop_session_${pdfFileName}`);
    if (saved) {
        try {
            const sessionData = JSON.parse(saved);
            verticalLines = sessionData.verticalLines || [20, 40, 60, 80];
            horizontalSplits = sessionData.horizontalSplits || [[], [], [], [], []];
            currentPage = sessionData.currentPage || 1;
            zoomScale = sessionData.zoomScale || 1.0;
            exportScale = sessionData.exportScale || 3.0;
            
            const colCount = sessionData.columnCount || (verticalLines.length + 1);
            
            // Sync column button state
            document.querySelectorAll('.col-btn').forEach(btn => {
                btn.classList.remove('active');
                if (parseInt(btn.dataset.cols) === colCount) {
                    btn.classList.add('active');
                }
            });
            
            if (baseFileNameInput && sessionData.baseName !== undefined) {
                baseFileNameInput.value = sessionData.baseName;
            }
            if (startNumberInput && sessionData.startNumber !== undefined) {
                startNumberInput.value = sessionData.startNumber;
            }
            if (autoNumberToggle && sessionData.autoNumber !== undefined) {
                autoNumberToggle.checked = sessionData.autoNumber;
            }
            
            // Sync UI
            currentPageNumEl.textContent = currentPage;
            updateZoomDisplay();
            initVerticalGuides();
            
            // Update quality buttons active class
            document.querySelectorAll('.quality-btn').forEach(btn => {
                btn.classList.remove('active');
                if (parseFloat(btn.dataset.scale) === exportScale) {
                    btn.classList.add('active');
                }
            });
            
            // Initialize history stack
            historyStack = [JSON.stringify(horizontalSplits)];
            redoStack = [];
        } catch(e) {
            console.error('Error restoring session:', e);
        }
    }
}

// --- Layout Profiles Manager ---

function loadProfilesFromStorage() {
    const savedProfiles = localStorage.getItem('pdf_crop_profiles');
    if (savedProfiles) {
        try {
            profiles = JSON.parse(savedProfiles);
        } catch(e) {
            console.error(e);
        }
    }
    renderProfileOptions();
}

function saveProfilesToStorage() {
    localStorage.setItem('pdf_crop_profiles', JSON.stringify(profiles));
}

function renderProfileOptions() {
    if (!profileSelect) return;
    profileSelect.innerHTML = '';
    Object.keys(profiles).forEach(pName => {
        const option = document.createElement('option');
        option.value = pName;
        option.textContent = pName === 'default' ? 'Default 5 Columns' : pName;
        profileSelect.appendChild(option);
    });
}

// Profile Events
if (profileSelect) {
    profileSelect.addEventListener('change', () => {
        const selected = profileSelect.value;
        if (profiles[selected]) {
            verticalLines = [...profiles[selected]];
            updateVerticalGuides();
            renderHorizontalSplits();
            renderSegments();
            saveSession();
        }
    });
}

if (saveProfileBtn) {
    saveProfileBtn.addEventListener('click', () => {
        const name = prompt('Enter a name for this vertical layout profile:');
        if (!name) return;
        const cleanName = name.trim();
        if (cleanName === 'default') {
            alert('Cannot overwrite the default profile.');
            return;
        }
        profiles[cleanName] = [...verticalLines];
        saveProfilesToStorage();
        renderProfileOptions();
        profileSelect.value = cleanName;
    });
}

if (deleteProfileBtn) {
    deleteProfileBtn.addEventListener('click', () => {
        const selected = profileSelect.value;
        if (selected === 'default') {
            alert('Cannot delete the default profile.');
            return;
        }
        if (confirm(`Are you sure you want to delete profile "${selected}"?`)) {
            delete profiles[selected];
            saveProfilesToStorage();
            renderProfileOptions();
            profileSelect.value = 'default';
            profileSelect.dispatchEvent(new Event('change'));
        }
    });
}

// --- PDF Compilation (jsPDF) ---

async function compileCropsToPdf() {
    if (crops.length === 0) return;
    showLoader('Generating PDF booklet...');
    
    try {
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({
            orientation: 'portrait',
            unit: 'px',
            format: 'a4'
        });
        
        const a4W = pdf.internal.pageSize.getWidth();
        const a4H = pdf.internal.pageSize.getHeight();
        const margin = 20; // margins
        const contentW = a4W - (margin * 2);
        
        const imagePromises = crops.map(crop => {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve({ img, crop });
                img.onerror = () => reject(new Error('Failed to load crop for PDF'));
                img.src = crop.dataUrl;
            });
        });
        
        const loadedImages = await Promise.all(imagePromises);
        
        loadedImages.forEach((item, index) => {
            if (index > 0) {
                pdf.addPage();
            }
            
            const imgW = item.crop.width;
            const imgH = item.crop.height;
            
            // Scale to fit content width
            const scale = contentW / imgW;
            const drawW = contentW;
            const drawH = imgH * scale;
            
            // Center vertically if it fits inside A4 page height
            let drawY = margin;
            if (drawH < a4H - (margin * 2)) {
                drawY = Math.round((a4H - drawH) / 2);
            }
            
            pdf.addImage(item.dataUrl || item.img, 'PNG', margin, drawY, drawW, drawH, undefined, 'FAST');
        });
        
        const pdfBaseName = baseFileNameInput.value.trim() || 'crops';
        pdf.save(`${pdfBaseName}_booklet.pdf`);
        hideLoader();
    } catch (err) {
        hideLoader();
        alert('PDF Generation failed: ' + err.message);
    }
}

if (downloadPdfBtn) {
    downloadPdfBtn.addEventListener('click', () => {
        compileCropsToPdf();
    });
}

// --- Keyboard Shortcuts & Input listeners ---

document.addEventListener('keydown', (e) => {
    // Ignore keydown if typing inside inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') {
        return;
    }
    
    // Page Navigation
    if (e.key === 'ArrowRight') {
        nextPageBtn.click();
    }
    if (e.key === 'ArrowLeft') {
        prevPageBtn.click();
    }
    
    // Enter to preview
    if (e.key === 'Enter') {
        generateCropsBtn.click();
    }
    
    // Escape to close preview modal
    if (e.key === 'Escape') {
        if (previewOverlay.style.display === 'flex') {
            backToEditorBtn.click();
        }
    }
    
    // Undo / Redo
    if (e.ctrlKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
    }
});

// Naming Inputs Listeners for Session Persistence
if (baseFileNameInput) {
    baseFileNameInput.addEventListener('input', () => saveSession());
}
if (startNumberInput) {
    startNumberInput.addEventListener('input', () => saveSession());
}
if (autoNumberToggle) {
    autoNumberToggle.addEventListener('change', () => saveSession());
}

// Load profiles from storage initially
loadProfilesFromStorage();

// --- Column Selector Controls ---

function setColumns(count, resetSplits = true) {
    document.querySelectorAll('.col-btn').forEach(btn => {
        btn.classList.remove('active');
        if (parseInt(btn.dataset.cols) === count) {
            btn.classList.add('active');
        }
    });
    
    if (resetSplits) {
        if (count === 1) {
            verticalLines = [];
        } else if (count === 2) {
            verticalLines = [50];
        } else if (count === 3) {
            verticalLines = [33.3, 66.6];
        } else if (count === 4) {
            verticalLines = [25, 50, 75];
        } else {
            verticalLines = [20, 40, 60, 80];
        }
        
        horizontalSplits = Array.from({ length: count }, () => []);
        historyStack = [JSON.stringify(horizontalSplits)];
        redoStack = [];
    }
    
    initVerticalGuides();
    renderHorizontalSplits();
    renderSegments();
    saveSession();
}

document.querySelectorAll('.col-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const count = parseInt(btn.dataset.cols);
        setColumns(count, true);
    });
});

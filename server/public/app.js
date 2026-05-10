/* Pi-Drive Frontend */
(() => {
  const socket = io();
  let currentPath = '';
  let selectedFile = null;
  let selectedFiles = new Set(); // multi-select: set of file paths
  let lastClickedIndex = -1;
  let currentFiles = [];
  let viewMode = localStorage.getItem('pidrive-view') || 'grid';
  let draggingFiles = null; // internal drag state

  // DOM elements
  const fileGrid = document.getElementById('fileGrid');
  const emptyState = document.getElementById('emptyState');
  const breadcrumbs = document.getElementById('breadcrumbs');
  const dropOverlay = document.getElementById('dropOverlay');
  const uploadProgress = document.getElementById('uploadProgress');
  const uploadProgressFill = document.getElementById('uploadProgressFill');
  const uploadProgressText = document.getElementById('uploadProgressText');
  const contextMenu = document.getElementById('contextMenu');
  const syncIndicator = document.getElementById('syncIndicator');
  const storageFill = document.getElementById('storageFill');
  const storageText = document.getElementById('storageText');
  const btnUpload = document.getElementById('btnUpload');
  const btnNewFolder = document.getElementById('btnNewFolder');
  const fileInput = document.getElementById('fileInput');
  const viewGridBtn = document.getElementById('viewGrid');
  const viewListBtn = document.getElementById('viewList');
  const selectionBar = document.getElementById('selectionBar');
  const selectionCount = document.getElementById('selectionCount');
  const btnMoveSelected = document.getElementById('btnMoveSelected');
  const btnDeleteSelected = document.getElementById('btnDeleteSelected');
  const btnClearSelection = document.getElementById('btnClearSelection');
  const fileListHeader = document.getElementById('fileListHeader');

  // ─── File type helpers ───
  const iconMap = {
    folder: { icon: 'folder', cls: 'folder' },
    image: { icon: 'image', cls: 'image' },
    video: { icon: 'movie', cls: 'video' },
    audio: { icon: 'audiotrack', cls: 'audio' },
    pdf: { icon: 'picture_as_pdf', cls: 'document' },
    document: { icon: 'description', cls: 'document' },
    archive: { icon: 'folder_zip', cls: 'archive' },
    code: { icon: 'code', cls: 'code' },
    default: { icon: 'insert_drive_file', cls: 'default' }
  };

  function getFileType(file) {
    if (file.isDirectory) return 'folder';
    const m = file.mime || '';
    if (m.startsWith('image/')) return 'image';
    if (m.startsWith('video/')) return 'video';
    if (m.startsWith('audio/')) return 'audio';
    if (m === 'application/pdf') return 'pdf';
    if (m.includes('zip') || m.includes('tar') || m.includes('rar') || m.includes('7z') || m.includes('compress')) return 'archive';
    if (m.includes('text/') || m.includes('json') || m.includes('xml') || m.includes('javascript') || m.includes('css')) return 'code';
    if (m.includes('document') || m.includes('word') || m.includes('sheet') || m.includes('presentation') || m.includes('excel') || m.includes('powerpoint')) return 'document';
    return 'default';
  }

  function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function formatDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  // ─── View mode ───
  function setViewMode(mode) {
    viewMode = mode;
    localStorage.setItem('pidrive-view', mode);
    viewGridBtn.classList.toggle('active', mode === 'grid');
    viewListBtn.classList.toggle('active', mode === 'list');
    fileGrid.classList.toggle('list-mode', mode === 'list');
    fileListHeader.hidden = mode !== 'list';
    renderFiles(currentFiles);
  }

  viewGridBtn.addEventListener('click', () => setViewMode('grid'));
  viewListBtn.addEventListener('click', () => setViewMode('list'));

  // ─── Selection ───
  function clearSelection() {
    selectedFiles.clear();
    selectedFile = null;
    lastClickedIndex = -1;
    updateSelectionUI();
  }

  function updateSelectionUI() {
    const count = selectedFiles.size;
    selectionBar.classList.toggle('inactive', count === 0);
    selectionCount.textContent = count ? `${count} selected` : 'None selected';
    btnMoveSelected.disabled = count === 0;
    btnDeleteSelected.disabled = count === 0;
    document.querySelectorAll('.file-item').forEach(el => {
      el.classList.toggle('selected', selectedFiles.has(el.dataset.path));
    });
  }

  function toggleFileSelection(filePath, index, e) {
    if (e.shiftKey && lastClickedIndex >= 0) {
      // Range select
      const start = Math.min(lastClickedIndex, index);
      const end = Math.max(lastClickedIndex, index);
      for (let i = start; i <= end; i++) {
        selectedFiles.add(currentFiles[i].path);
      }
    } else if (e.ctrlKey || e.metaKey) {
      // Toggle single
      if (selectedFiles.has(filePath)) {
        selectedFiles.delete(filePath);
      } else {
        selectedFiles.add(filePath);
      }
    } else {
      // Single select
      selectedFiles.clear();
      selectedFiles.add(filePath);
    }
    lastClickedIndex = index;
    selectedFile = currentFiles[index];
    updateSelectionUI();
  }

  btnClearSelection.addEventListener('click', () => { clearSelection(); });

  // ─── Fetch files ───
  async function loadFiles() {
    try {
      const res = await fetch(`/api/files?path=${encodeURIComponent(currentPath)}`);
      const data = await res.json();
      currentFiles = data.files;
      clearSelection();
      renderFiles(currentFiles);
      updateBreadcrumbs();
    } catch (err) {
      toast('Failed to load files', 'error');
    }
  }

  // ─── Render file grid ───
  function renderFiles(files) {
    fileGrid.innerHTML = '';

    // ".." parent folder item when in a subfolder
    if (currentPath) {
      const parentPath = currentPath.split('/').filter(Boolean).slice(0, -1).join('/');
      const parentEl = document.createElement('div');
      parentEl.className = 'file-item parent-dir';
      parentEl.title = 'Double-click to go up — or drag files here to move to parent';
      if (viewMode === 'list') {
        parentEl.innerHTML = `
          <span class="material-icons-outlined file-icon folder">drive_folder_upload</span>
          <span class="file-name">..</span>
          <span class="file-size">—</span>
          <span class="file-modified">Parent folder</span>
        `;
      } else {
        parentEl.innerHTML = `
          <span class="material-icons-outlined file-icon folder">drive_folder_upload</span>
          <div class="file-name">..</div>
        `;
      }
      parentEl.addEventListener('dblclick', (e) => {
        e.preventDefault();
        currentPath = parentPath;
        loadFiles();
      });
      parentEl.addEventListener('dragover', (e) => {
        if (!draggingFiles) return;
        e.preventDefault(); e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        parentEl.classList.add('drop-target');
      });
      parentEl.addEventListener('dragleave', () => parentEl.classList.remove('drop-target'));
      parentEl.addEventListener('drop', async (e) => {
        e.preventDefault(); e.stopPropagation();
        parentEl.classList.remove('drop-target');
        const data = e.dataTransfer.getData('application/x-pidrive');
        if (!data) return;
        const filesToMove = JSON.parse(data);
        try {
          const res = await fetch('/api/move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: filesToMove, destination: parentPath })
          });
          const result = await res.json();
          toast(`Moved ${result.results.filter(r => r.moved).length} item(s) to parent`, 'success');
          loadFiles();
        } catch { toast('Move failed', 'error'); }
      });
      fileGrid.appendChild(parentEl);
    }

    if (!files.length) {
      emptyState.hidden = !currentPath; // show empty only if truly empty (not just parent-dir)
      if (!currentPath) { fileListHeader.hidden = true; return; }
      fileListHeader.hidden = viewMode !== 'list';
      return;
    }
    emptyState.hidden = true;
    fileListHeader.hidden = viewMode !== 'list';

    files.forEach((file, index) => {
      const type = getFileType(file);
      const info = iconMap[type] || iconMap.default;

      const el = document.createElement('div');
      el.className = 'file-item';
      el.dataset.path = file.path;
      el.dataset.name = file.name;
      el.dataset.isDir = file.isDirectory;
      if (selectedFiles.has(file.path)) el.classList.add('selected');

      if (viewMode === 'list') {
        el.innerHTML = `
          <span class="material-icons-outlined file-icon ${info.cls}">${info.icon}</span>
          <span class="file-name" title="${file.name}">${file.name}</span>
          <span class="file-size">${file.isDirectory ? '—' : formatSize(file.size)}</span>
          <span class="file-modified">${formatDate(file.modified)}</span>
        `;
      } else {
        el.innerHTML = `
          <span class="material-icons-outlined file-icon ${info.cls}">${info.icon}</span>
          <div class="file-name" title="${file.name}">${file.name}</div>
          ${!file.isDirectory ? `<div class="file-size">${formatSize(file.size)}</div>` : ''}
        `;
      }

      // Double click: open folder or download file
      el.addEventListener('dblclick', (e) => {
        e.preventDefault();
        if (file.isDirectory) {
          currentPath = file.path;
          loadFiles();
        } else {
          window.open(`/api/download/${encodeURIComponent(file.path)}`, '_blank');
        }
      });

      // Right-click context menu
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (!selectedFiles.has(file.path)) {
          selectedFiles.clear();
          selectedFiles.add(file.path);
          selectedFile = file;
          updateSelectionUI();
        }
        showContextMenu(e.clientX, e.clientY);
      });

      // Single click: select (with multi-select support)
      el.addEventListener('click', (e) => {
        toggleFileSelection(file.path, index, e);
      });

      // ─── Internal drag (move to folder) ───
      el.draggable = true;
      el.addEventListener('dragstart', (e) => {
        // If dragged item isn't selected, select only it
        if (!selectedFiles.has(file.path)) {
          selectedFiles.clear();
          selectedFiles.add(file.path);
          selectedFile = file;
          updateSelectionUI();
        }
        draggingFiles = [...selectedFiles];
        e.dataTransfer.setData('application/x-pidrive', JSON.stringify(draggingFiles));
        e.dataTransfer.effectAllowed = 'move';
        el.classList.add('dragging');
        // Ghost badge showing count
        if (selectedFiles.size > 1) {
          const badge = document.createElement('div');
          badge.className = 'drag-badge';
          badge.textContent = selectedFiles.size;
          document.body.appendChild(badge);
          e.dataTransfer.setDragImage(badge, 20, 20);
          setTimeout(() => badge.remove(), 0);
        }
      });
      el.addEventListener('dragend', () => {
        el.classList.remove('dragging');
        draggingFiles = null;
        document.querySelectorAll('.file-item.drop-target').forEach(d => d.classList.remove('drop-target'));
      });

      // Folders are drop targets
      if (file.isDirectory) {
        el.addEventListener('dragover', (e) => {
          if (!draggingFiles) return; // only internal drags
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'move';
          el.classList.add('drop-target');
        });
        el.addEventListener('dragleave', (e) => {
          el.classList.remove('drop-target');
        });
        el.addEventListener('drop', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          el.classList.remove('drop-target');
          const data = e.dataTransfer.getData('application/x-pidrive');
          if (!data) return;
          const filesToMove = JSON.parse(data);
          // Don't move folder into itself
          const filtered = filesToMove.filter(f => f !== file.path);
          if (!filtered.length) return;
          try {
            const res = await fetch('/api/move', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ files: filtered, destination: file.path })
            });
            const result = await res.json();
            const moved = result.results.filter(r => r.moved).length;
            toast(`Moved ${moved} item(s) to ${file.name}`, 'success');
            loadFiles();
          } catch {
            toast('Move failed', 'error');
          }
        });
      }

      fileGrid.appendChild(el);
    });
  }

  // ─── Breadcrumbs ───
  function updateBreadcrumbs() {
    breadcrumbs.innerHTML = '';
    const parts = currentPath ? currentPath.split('/').filter(Boolean) : [];

    const root = document.createElement('button');
    root.className = 'breadcrumb-item';
    root.textContent = 'Pi-Drive';
    root.addEventListener('click', () => { currentPath = ''; loadFiles(); });
    breadcrumbs.appendChild(root);

    let accumulated = '';
    parts.forEach((part, i) => {
      const sep = document.createElement('span');
      sep.className = 'breadcrumb-sep';
      sep.textContent = '›';
      breadcrumbs.appendChild(sep);

      accumulated += (accumulated ? '/' : '') + part;
      const btn = document.createElement('button');
      btn.className = 'breadcrumb-item';
      btn.textContent = part;
      const pathSnapshot = accumulated;
      btn.addEventListener('click', () => { currentPath = pathSnapshot; loadFiles(); });
      breadcrumbs.appendChild(btn);
    });
  }

  // ─── Context menu ───
  function showContextMenu(x, y) {
    contextMenu.hidden = false;
    contextMenu.style.left = Math.min(x, window.innerWidth - 200) + 'px';
    contextMenu.style.top = Math.min(y, window.innerHeight - 160) + 'px';
  }

  function hideContextMenu() {
    contextMenu.hidden = true;
  }

  document.addEventListener('click', (e) => {
    if (!contextMenu.contains(e.target)) hideContextMenu();
  });

  contextMenu.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!selectedFile) return;
      const action = btn.dataset.action;
      if (action === 'download') {
        window.open(`/api/download/${encodeURIComponent(selectedFile.path)}`, '_blank');
      } else if (action === 'rename') {
        startRename(selectedFile);
      } else if (action === 'delete') {
        if (selectedFiles.size > 1) {
          bulkDelete();
        } else {
          deleteFile(selectedFile);
        }
      }
      hideContextMenu();
    });
  });

  // ─── Rename ───
  function startRename(file) {
    const el = document.querySelector(`.file-item[data-path="${CSS.escape(file.path)}"] .file-name`);
    if (!el) return;
    const input = document.createElement('input');
    input.className = 'rename-input';
    input.value = file.name;
    el.replaceWith(input);
    input.focus();
    input.select();

    const finish = async () => {
      const newName = input.value.trim();
      if (newName && newName !== file.name) {
        try {
          await fetch(`/api/files/${encodeURIComponent(file.path)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newName })
          });
          toast('Renamed', 'success');
        } catch {
          toast('Rename failed', 'error');
        }
      }
      loadFiles();
    };

    input.addEventListener('blur', finish);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') { input.value = file.name; input.blur(); }
    });
  }

  // ─── Delete ───
  async function deleteFile(file) {
    if (!confirm(`Delete "${file.name}"?`)) return;
    try {
      await fetch(`/api/files/${encodeURIComponent(file.path)}`, { method: 'DELETE' });
      toast('Deleted', 'success');
      loadFiles();
    } catch {
      toast('Delete failed', 'error');
    }
  }

  // ─── Bulk Delete ───
  async function bulkDelete() {
    const count = selectedFiles.size;
    if (!confirm(`Delete ${count} item(s)?`)) return;
    let ok = 0;
    for (const fp of selectedFiles) {
      try {
        await fetch(`/api/files/${encodeURIComponent(fp)}`, { method: 'DELETE' });
        ok++;
      } catch {}
    }
    toast(`Deleted ${ok} item(s)`, 'success');
    loadFiles();
  }

  btnDeleteSelected.addEventListener('click', bulkDelete);

  // ─── Bulk Move (folder tree picker) ───
  const moveModal = document.getElementById('moveModal');
  const btnCloseMoveModal = document.getElementById('btnCloseMoveModal');
  const folderTree = document.getElementById('folderTree');
  const moveDestLabel = document.getElementById('moveDestLabel');
  const btnConfirmMove = document.getElementById('btnConfirmMove');
  let selectedMoveDest = null;

  btnCloseMoveModal.addEventListener('click', () => { moveModal.hidden = true; });
  moveModal.addEventListener('click', (e) => { if (e.target === moveModal) moveModal.hidden = true; });

  function buildTreeNode(name, path, depth) {
    const wrapper = document.createElement('div');

    const row = document.createElement('div');
    row.className = 'folder-tree-row';
    row.style.paddingLeft = (8 + depth * 18) + 'px';

    const expand = document.createElement('span');
    expand.className = 'material-icons-outlined folder-tree-expand';
    expand.textContent = 'chevron_right';

    const icon = document.createElement('span');
    icon.className = 'material-icons-outlined folder-tree-icon';
    icon.textContent = 'folder';

    const label = document.createElement('span');
    label.textContent = name;
    label.style.flex = '1';

    row.appendChild(expand);
    row.appendChild(icon);
    row.appendChild(label);
    wrapper.appendChild(row);

    let expanded = false;
    let childrenDiv = null;

    row.addEventListener('click', (e) => {
      e.stopPropagation();
      folderTree.querySelectorAll('.folder-tree-row.selected').forEach(r => r.classList.remove('selected'));
      row.classList.add('selected');
      selectedMoveDest = path;
      moveDestLabel.textContent = path === '' ? 'Root (Pi-Drive)' : path;
      btnConfirmMove.disabled = false;
    });

    expand.addEventListener('click', async (e) => {
      e.stopPropagation();
      expanded = !expanded;
      expand.classList.toggle('open', expanded);
      if (expanded) {
        if (!childrenDiv) {
          childrenDiv = document.createElement('div');
          childrenDiv.className = 'folder-tree-children';
          childrenDiv.innerHTML = '<div style="color:var(--text-dim);font-size:0.75rem;padding:4px 8px">Loading…</div>';
          wrapper.appendChild(childrenDiv);
          try {
            const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
            const data = await res.json();
            const subs = data.files.filter(f => f.isDirectory);
            childrenDiv.innerHTML = '';
            if (subs.length) subs.forEach(s => childrenDiv.appendChild(buildTreeNode(s.name, s.path, depth + 1)));
            else childrenDiv.innerHTML = '<div style="color:var(--text-dim);font-size:0.75rem;padding:4px 8px">No subfolders</div>';
          } catch {
            childrenDiv.innerHTML = '<div style="color:var(--danger);font-size:0.75rem;padding:4px 8px">Error</div>';
          }
        } else {
          childrenDiv.hidden = false;
        }
      } else {
        if (childrenDiv) childrenDiv.hidden = true;
      }
    });

    return wrapper;
  }

  async function bulkMove() {
    if (!selectedFiles.size) return;
    selectedMoveDest = null;
    btnConfirmMove.disabled = true;
    moveDestLabel.textContent = 'Select a folder';
    folderTree.innerHTML = '<div style="color:var(--text-dim);font-size:0.8rem;padding:8px">Loading…</div>';
    moveModal.hidden = false;

    try {
      // Root node
      const rootWrapper = document.createElement('div');
      const rootRow = document.createElement('div');
      rootRow.className = 'folder-tree-row';
      rootRow.style.paddingLeft = '8px';
      rootRow.innerHTML = `
        <span class="material-icons-outlined folder-tree-expand hidden">chevron_right</span>
        <span class="material-icons-outlined folder-tree-icon">home</span>
        <span style="flex:1">Pi-Drive (root)</span>
      `;
      rootRow.addEventListener('click', () => {
        folderTree.querySelectorAll('.folder-tree-row.selected').forEach(r => r.classList.remove('selected'));
        rootRow.classList.add('selected');
        selectedMoveDest = '';
        moveDestLabel.textContent = 'Root (Pi-Drive)';
        btnConfirmMove.disabled = false;
      });
      rootWrapper.appendChild(rootRow);

      const res = await fetch('/api/files?path=');
      const data = await res.json();
      const topFolders = data.files.filter(f => f.isDirectory);
      if (topFolders.length) {
        const childrenDiv = document.createElement('div');
        childrenDiv.className = 'folder-tree-children';
        topFolders.forEach(f => childrenDiv.appendChild(buildTreeNode(f.name, f.path, 1)));
        rootWrapper.appendChild(childrenDiv);
      }

      folderTree.innerHTML = '';
      folderTree.appendChild(rootWrapper);
    } catch {
      folderTree.innerHTML = '<div style="color:var(--danger);font-size:0.8rem;padding:8px">Failed to load folders</div>';
    }
  }

  btnMoveSelected.addEventListener('click', bulkMove);

  btnConfirmMove.addEventListener('click', async () => {
    if (selectedMoveDest === null) return;
    moveModal.hidden = true;
    try {
      const res = await fetch('/api/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: [...selectedFiles], destination: selectedMoveDest })
      });
      const data = await res.json();
      const moved = data.results.filter(r => r.moved).length;
      toast(`Moved ${moved} item(s)`, 'success');
      loadFiles();
    } catch {
      toast('Move failed', 'error');
    }
  });

  // ─── Upload ───
  btnUpload.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) uploadFiles(fileInput.files);
    fileInput.value = '';
  });

  async function uploadFiles(fileList) {
    const formData = new FormData();
    formData.append('path', currentPath);
    for (const f of fileList) {
      formData.append('files', f);
    }

    uploadProgress.hidden = false;
    uploadProgressFill.style.width = '0%';
    uploadProgressText.textContent = `Uploading ${fileList.length} file(s)...`;

    try {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload');

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          uploadProgressFill.style.width = pct + '%';
          uploadProgressText.textContent = `Uploading... ${pct}%`;
        }
      };

      xhr.onload = () => {
        uploadProgress.hidden = true;
        if (xhr.status === 200) {
          toast('Upload complete', 'success');
          loadFiles();
        } else {
          toast('Upload failed', 'error');
        }
      };

      xhr.onerror = () => {
        uploadProgress.hidden = true;
        toast('Upload failed', 'error');
      };

      xhr.send(formData);
    } catch {
      uploadProgress.hidden = true;
      toast('Upload failed', 'error');
    }
  }

  // ─── Drag & Drop ───
  let dragCounter = 0;

  document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    if (draggingFiles) return; // internal drag, skip overlay
    dragCounter++;
    dropOverlay.classList.add('active');
  });

  document.addEventListener('dragleave', (e) => {
    e.preventDefault();
    if (draggingFiles) return;
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      dropOverlay.classList.remove('active');
    }
  });

  document.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  document.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    dropOverlay.classList.remove('active');
    if (draggingFiles) return; // handled by folder drop target
    if (e.dataTransfer.files.length) {
      uploadFiles(e.dataTransfer.files);
    }
  });

  // ─── New Folder ───
  btnNewFolder.addEventListener('click', () => {
    const name = prompt('Folder name:');
    if (!name) return;
    fetch('/api/folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: currentPath, name })
    }).then(() => {
      toast('Folder created', 'success');
      loadFiles();
    }).catch(() => toast('Failed to create folder', 'error'));
  });

  // ─── Keyboard shortcuts ───
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' && selectedFiles.size > 0) {
      if (selectedFiles.size > 1) bulkDelete();
      else if (selectedFile) deleteFile(selectedFile);
    }
    if (e.key === 'Backspace' && !document.querySelector('.rename-input:focus') && currentPath) {
      const parts = currentPath.split('/').filter(Boolean);
      parts.pop();
      currentPath = parts.join('/');
      loadFiles();
    }
    if (e.key === 'Escape') {
      clearSelection();
    }
    // Ctrl/Cmd+A: select all
    if ((e.ctrlKey || e.metaKey) && e.key === 'a' && !document.querySelector('input:focus')) {
      e.preventDefault();
      currentFiles.forEach(f => selectedFiles.add(f.path));
      updateSelectionUI();
    }
  });

  // Click on empty area to deselect
  document.getElementById('fileContainer').addEventListener('click', (e) => {
    if (e.target.id === 'fileGrid' || e.target.id === 'fileContainer') {
      clearSelection();
    }
  });

  // ─── Storage stats ───
  async function loadStats() {
    try {
      const res = await fetch('/api/stats');
      const data = await res.json();
      if (data.total) {
        const pct = ((data.used / data.total) * 100).toFixed(1);
        storageFill.style.width = pct + '%';
        storageText.textContent = `${formatSize(data.available)} free of ${formatSize(data.total)}`;
      }
    } catch {}
  }

  // ─── Socket.IO real-time sync ───
  socket.on('connect', () => {
    syncIndicator.classList.remove('disconnected');
    syncIndicator.title = 'Connected';
  });

  socket.on('disconnect', () => {
    syncIndicator.classList.add('disconnected');
    syncIndicator.title = 'Disconnected';
  });

  socket.on('files-changed', () => {
    loadFiles();
    loadStats();
  });

  // ─── Toast ───
  function toast(message, type = '') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  // ─── Settings / WiFi ───
  const settingsModal = document.getElementById('settingsModal');
  const btnSettings = document.getElementById('btnSettings');
  const btnCloseSettings = document.getElementById('btnCloseSettings');
  const wifiSaved = document.getElementById('wifiSaved');
  const wifiSSID = document.getElementById('wifiSSID');
  const wifiPassword = document.getElementById('wifiPassword');
  const wifiScanList = document.getElementById('wifiScanList');
  const btnWifiScan = document.getElementById('btnWifiScan');
  const btnWifiSave = document.getElementById('btnWifiSave');

  btnSettings.addEventListener('click', () => {
    settingsModal.hidden = false;
    loadWifiNetworks();
  });

  btnCloseSettings.addEventListener('click', () => { settingsModal.hidden = true; });
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) settingsModal.hidden = true;
  });

  async function loadWifiNetworks() {
    wifiSaved.innerHTML = '<p class="text-dim">Loading...</p>';
    try {
      const res = await fetch('/api/wifi');
      const data = await res.json();
      if (!data.networks.length) {
        wifiSaved.innerHTML = '<p class="text-dim">No saved WiFi networks</p>';
        return;
      }
      wifiSaved.innerHTML = '';
      data.networks.forEach(net => {
        const row = document.createElement('div');
        row.className = 'wifi-item';
        row.innerHTML = `
          <span class="material-icons-outlined wifi-status ${net.active ? 'active' : ''}">
            ${net.active ? 'wifi' : 'wifi_off'}
          </span>
          <span class="wifi-ssid">${net.ssid}</span>
          ${net.active ? '<span class="wifi-badge">Connected</span>' : ''}
          <button class="btn btn-sm" data-edit="${net.ssid}" title="Update password">
            <span class="material-icons-outlined">edit</span>
          </button>
          <button class="btn btn-sm danger" data-delete="${net.name}" title="Forget network">
            <span class="material-icons-outlined">delete</span>
          </button>
        `;
        row.querySelector('[data-edit]').addEventListener('click', () => {
          wifiSSID.value = net.ssid;
          wifiPassword.value = '';
          wifiPassword.focus();
        });
        row.querySelector('[data-delete]').addEventListener('click', async () => {
          if (!confirm(`Forget "${net.ssid}"?`)) return;
          try {
            await fetch(`/api/wifi/${encodeURIComponent(net.name)}`, { method: 'DELETE' });
            toast('Network removed', 'success');
            loadWifiNetworks();
          } catch { toast('Failed to remove', 'error'); }
        });
        wifiSaved.appendChild(row);
      });
    } catch {
      wifiSaved.innerHTML = '<p class="text-dim">WiFi management not available (nmcli required)</p>';
    }
  }

  const wifiScanResults = document.getElementById('wifiScanResults');

  btnWifiScan.addEventListener('click', async () => {
    btnWifiScan.disabled = true;
    btnWifiScan.innerHTML = '<span class="material-icons-outlined">radar</span> Scanning...';
    try {
      const res = await fetch('/api/wifi/scan');
      const data = await res.json();
      wifiScanList.innerHTML = '';
      wifiScanResults.innerHTML = '';
      if (data.networks.length) {
        wifiScanResults.hidden = false;
        data.networks.forEach(n => {
          // datalist option for autocomplete
          const opt = document.createElement('option');
          opt.value = n.ssid;
          wifiScanList.appendChild(opt);
          // visible clickable row
          const row = document.createElement('div');
          row.className = 'wifi-scan-row';
          row.innerHTML = `
            <span class="material-icons-outlined">wifi</span>
            <span class="wifi-scan-ssid">${n.ssid}</span>
            <span class="wifi-scan-signal">${n.signal}%</span>
            <span class="wifi-scan-sec">${n.security || 'Open'}</span>
          `;
          row.addEventListener('click', () => {
            wifiSSID.value = n.ssid;
            wifiScanResults.hidden = true;
            wifiPassword.focus();
          });
          wifiScanResults.appendChild(row);
        });
      } else {
        wifiScanResults.hidden = true;
      }
      toast(`Found ${data.networks.length} networks`, 'success');
    } catch { toast('Scan failed', 'error'); }
    btnWifiScan.disabled = false;
    btnWifiScan.innerHTML = '<span class="material-icons-outlined">radar</span> Scan';
  });

  btnWifiSave.addEventListener('click', async () => {
    const ssid = wifiSSID.value.trim();
    const password = wifiPassword.value;
    if (!ssid) { toast('Enter SSID', 'error'); return; }
    btnWifiSave.disabled = true;
    btnWifiSave.textContent = 'Connecting...';
    try {
      const res = await fetch('/api/wifi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ssid, password })
      });
      const data = await res.json();
      if (res.ok) {
        toast(data.updated ? `Updated ${ssid}` : `Connected to ${ssid}`, 'success');
        wifiSSID.value = '';
        wifiPassword.value = '';
        setTimeout(loadWifiNetworks, 1000);
      } else {
        toast(data.error || 'Failed', 'error');
      }
    } catch { toast('Connection failed', 'error'); }
    btnWifiSave.disabled = false;
    btnWifiSave.innerHTML = '<span class="material-icons-outlined">add</span> Save & Connect';
  });

  // ─── Shutdown ───
  document.getElementById('btnShutdown').addEventListener('click', async () => {
    if (!confirm('Shutdown the Pi now?')) return;
    try {
      await fetch('/api/shutdown', { method: 'POST' });
      toast('Pi is shutting down...', 'success');
    } catch {
      toast('Shutdown failed', 'error');
    }
  });

  // ─── WiFi status chip ───
  async function loadWifiStatus() {
    try {
      const res = await fetch('/api/wifi-current');
      const data = await res.json();
      const chip = document.getElementById('wifiChip');
      const icon = document.getElementById('wifiChipIcon');
      const ssidEl = document.getElementById('wifiChipSsid');
      chip.className = 'wifi-chip';
      if (data.ssid && data.mode === 'client') {
        chip.classList.add('connected');
        icon.textContent = 'wifi';
        ssidEl.textContent = data.ssid;
        chip.title = `WiFi: ${data.ssid}`;
      } else if (data.mode === 'ap') {
        chip.classList.add('ap');
        icon.textContent = 'wifi_tethering';
        ssidEl.textContent = 'Pi-Drive AP';
        chip.title = 'Hotspot active (no WiFi connection)';
      } else {
        icon.textContent = 'wifi_off';
        ssidEl.textContent = 'No WiFi';
        chip.title = 'Not connected to WiFi';
      }
    } catch {}
  }

  // ─── Init ───
  setViewMode(viewMode);
  loadFiles();
  loadStats();
  loadWifiStatus();
  setInterval(loadStats, 30000);
  setInterval(loadWifiStatus, 30000);
})();

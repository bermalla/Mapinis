(function(){
  let initialized = false;
  let scene, camera, renderer, controls;
  let objectsGroup;
  let minimapSnapshot = null;
  let collisionCells = new Map();
  let solidObstacles = [];
  let animationId = null;
  let moveState = { forward: false, back: false, left: false, right: false, shift: false };
  let velocity = null;
  let direction = null;
  let prevTime = performance.now();
  const minecraftBlockSize = 1;
  const cellSize = minecraftBlockSize;
  const playerHeight = 1.62;
  const baseMoveSpeed = 4.3;
  const sprintMultiplier = 1.3;
  const blockHeight = 4;
  const minimapZoom = 7.5;
  const playerRadius = 0.3;
  const obstacleScale = 1;

  const viewerModal = document.getElementById('viewerModal');
  const viewerContainer = document.getElementById('viewerContainer');
  const viewerMinimap = document.getElementById('viewerMinimap');
  const open3DBtn = document.getElementById('open3D');
  const close3DBtn = document.getElementById('close3D');

  function canUseThree() {
    return typeof window.THREE !== 'undefined';
  }

  function resetMovementState() {
    moveState = { forward: false, back: false, left: false, right: false, shift: false };
    if (canUseThree()) {
      velocity = new THREE.Vector3();
      direction = new THREE.Vector3();
    } else {
      velocity = null;
      direction = null;
    }
  }

  function safeColor(fill) {
    if (!fill || fill === 'transparent') return 0x9e9e9e;
    try {
      if (typeof fill === 'string' && fill[0] === '#') return parseInt(fill.slice(1), 16);
    } catch (e) {}
    return 0x9e9e9e;
  }

  function makeMaterial(color, side) {
    return new THREE.MeshStandardMaterial({
      color,
      side: side || THREE.FrontSide,
      roughness: 0.82,
      metalness: 0.0,
    });
  }

  function getEditorSnapshot() {
    if (window.MapinisEditor && typeof window.MapinisEditor.getSnapshot === 'function') {
      return window.MapinisEditor.getSnapshot();
    }
    return {
      grid: {
        cols: typeof window.cols === 'number' ? window.cols : 100,
        rows: typeof window.rows === 'number' ? window.rows : 72,
        gridSize: typeof window.gridSize === 'number' ? window.gridSize : 28,
      },
      items: Array.isArray(window.items) ? window.items : [],
      showNotes: true,
    };
  }

  function getItemFill(item) {
    return item && item.style && typeof item.style.fill === 'string' ? item.style.fill : item.fill;
  }

  function getItemStroke(item) {
    return item && item.style && typeof item.style.stroke === 'string' ? item.style.stroke : item.stroke;
  }

  function isMinimapItemVisible(item, showNotes) {
    return item && (!(item.meta && item.meta.notes) || showNotes);
  }

  function isViewerGeometry(item, showNotes) {
    if (!item) return false;
    if (item.meta && item.meta.notes && !showNotes) return false;
    if (item.type === 'note') return false;
    if (item.type === 'pov3d') return false;
    if (item.type === 'obstacle') return false;
    return getItemFill(item) !== 'transparent';
  }

  function cellKey(col, row) {
    return `${col},${row}`;
  }

  function buildOccupiedCells(items, showNotes) {
    const cells = new Map();
    items.forEach((item) => {
      if (!isViewerGeometry(item, showNotes) || typeof item.col !== 'number' || typeof item.row !== 'number') return;
      const width = Math.max(1, item.w || 1);
      const height = Math.max(1, item.h || 1);
      for (let col = item.col; col < item.col + width; col += 1) {
        for (let row = item.row; row < item.row + height; row += 1) {
          cells.set(cellKey(col, row), { item, col, row });
        }
      }
    });
    return cells;
  }

  function buildSolidObstacles(items, showNotes) {
    const solids = [];
    items.forEach((item) => {
      if (!item || item.type !== 'obstacle') return;
      if (item.meta && item.meta.notes && !showNotes) return;
      if (typeof item.col !== 'number' || typeof item.row !== 'number') return;

      const width = Math.max(1, item.w || 1);
      const height = Math.max(1, item.h || 1);
      const size = cellSize * obstacleScale;
      const half = size / 2;

      for (let col = item.col; col < item.col + width; col += 1) {
        for (let row = item.row; row < item.row + height; row += 1) {
          const centerX = (col + 0.5) * cellSize;
          const centerZ = (row + 0.5) * cellSize;
          solids.push({
            item,
            col,
            row,
            centerX,
            centerZ,
            size,
            minX: centerX - half,
            maxX: centerX + half,
            minZ: centerZ - half,
            maxZ: centerZ + half,
          });
        }
      }
    });
    return solids;
  }

  function addEdges(mesh, color) {
    const edgeGeometry = new THREE.EdgesGeometry(mesh.geometry);
    const edgeMaterial = new THREE.LineBasicMaterial({ color, linewidth: 1 });
    const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    mesh.add(edges);
  }

  function buildSceneFromItems() {
    if (!objectsGroup) {
      objectsGroup = new THREE.Group();
      scene.add(objectsGroup);
    }
    // clear previous
    while (objectsGroup.children.length) objectsGroup.remove(objectsGroup.children[0]);

    const snapshot = getEditorSnapshot();
    const appItems = Array.isArray(snapshot.items) ? snapshot.items : [];
    collisionCells = buildOccupiedCells(appItems, snapshot.showNotes);
    solidObstacles = buildSolidObstacles(appItems, snapshot.showNotes);
    if (!appItems.length) return;

    const ceilingMaterial = makeMaterial(0xf8f8f4, THREE.DoubleSide);
    const blockGeometry = new THREE.BoxGeometry(minecraftBlockSize, minecraftBlockSize, minecraftBlockSize);
    const obstacleGeometry = new THREE.BoxGeometry(cellSize * obstacleScale, cellSize * obstacleScale, cellSize * obstacleScale);
    const occupiedCells = collisionCells;

    function addBlock(x, y, z, material, edgeColor) {
      const block = new THREE.Mesh(blockGeometry, material);
      block.position.set(x, y, z);
      objectsGroup.add(block);
      if (typeof edgeColor === 'number') addEdges(block, edgeColor);
      return block;
    }

    function addWallColumn(x, z, material) {
      for (let y = 0; y < blockHeight; y += 1) {
        addBlock(x, y + minecraftBlockSize / 2, z, material, 0x333333);
      }
    }

    occupiedCells.forEach((cell) => {
      const item = cell.item;
      const color = safeColor(getItemFill(item));
      const wallMaterial = makeMaterial(color, THREE.DoubleSide);
      const floorMaterial = makeMaterial(color, THREE.DoubleSide);
      const minX = cell.col * cellSize;
      const minZ = cell.row * cellSize;
      const centerX = minX + cellSize / 2;
      const centerZ = minZ + cellSize / 2;

      addBlock(centerX, -minecraftBlockSize / 2, centerZ, floorMaterial);
      addBlock(centerX, blockHeight + minecraftBlockSize / 2, centerZ, ceilingMaterial);

      if (!occupiedCells.has(cellKey(cell.col, cell.row - 1))) {
        addWallColumn(centerX, minZ - cellSize / 2, wallMaterial);
      }

      if (!occupiedCells.has(cellKey(cell.col, cell.row + 1))) {
        addWallColumn(centerX, minZ + cellSize + cellSize / 2, wallMaterial);
      }

      if (!occupiedCells.has(cellKey(cell.col - 1, cell.row))) {
        addWallColumn(minX - cellSize / 2, centerZ, wallMaterial);
      }

      if (!occupiedCells.has(cellKey(cell.col + 1, cell.row))) {
        addWallColumn(minX + cellSize + cellSize / 2, centerZ, wallMaterial);
      }
    });

    solidObstacles.forEach((solid) => {
      const color = safeColor(getItemFill(solid.item));
      const obstacle = new THREE.Mesh(obstacleGeometry, makeMaterial(color, THREE.DoubleSide));
      obstacle.position.set(solid.centerX, solid.size / 2, solid.centerZ);
      objectsGroup.add(obstacle);
      addEdges(obstacle, 0x222222);
    });
  }

  function setupMinimap(snapshot) {
    minimapSnapshot = snapshot || getEditorSnapshot();
    drawMinimap();
  }

  function splitLongWordForCanvas(ctx, word, maxWidth) {
    const chunks = [];
    let chunk = "";
    String(word).split("").forEach((char) => {
      const candidate = chunk + char;
      if (chunk && ctx.measureText(candidate).width > maxWidth) {
        chunks.push(chunk);
        chunk = char;
      } else {
        chunk = candidate;
      }
    });
    if (chunk) chunks.push(chunk);
    return chunks;
  }

  function wrapCanvasText(ctx, text, maxWidth) {
    const paragraphs = String(text || "").split(/\r?\n/);
    const lines = [];

    paragraphs.forEach((paragraph) => {
      const words = paragraph.trim().split(/\s+/).filter(Boolean);
      if (!words.length) {
        lines.push("");
        return;
      }

      let currentLine = "";
      words.forEach((word) => {
        if (ctx.measureText(word).width > maxWidth) {
          if (currentLine) {
            lines.push(currentLine);
            currentLine = "";
          }
          lines.push(...splitLongWordForCanvas(ctx, word, maxWidth));
          return;
        }

        const candidate = currentLine ? `${currentLine} ${word}` : word;
        if (!currentLine || ctx.measureText(candidate).width <= maxWidth) {
          currentLine = candidate;
        } else {
          lines.push(currentLine);
          currentLine = word;
        }
      });

      if (currentLine) lines.push(currentLine);
    });

    return lines;
  }

  function fitCanvasText(ctx, text, maxWidth, maxHeight, preferredSize) {
    for (let fontSize = preferredSize; fontSize >= 4; fontSize -= 0.5) {
      ctx.font = `${fontSize}px Arial, sans-serif`;
      const lineHeight = fontSize * 1.15;
      const lines = wrapCanvasText(ctx, text, maxWidth);
      if (lines.length && lines.length * lineHeight <= maxHeight) {
        return { fontSize, lineHeight, lines };
      }
    }

    ctx.font = '4px Arial, sans-serif';
    return { fontSize: 4, lineHeight: 4.6, lines: wrapCanvasText(ctx, text, maxWidth) };
  }

  function drawMinimap() {
    if (!viewerMinimap || !camera || !minimapSnapshot) return;
    const ctx = viewerMinimap.getContext('2d');
    if (!ctx) return;

    const grid = minimapSnapshot.grid || {};
    const mapCols = typeof grid.cols === 'number' ? grid.cols : 100;
    const mapRows = typeof grid.rows === 'number' ? grid.rows : 72;
    const cssWidth = viewerMinimap.clientWidth || 240;
    const cssHeight = viewerMinimap.clientHeight || Math.round(cssWidth * mapRows / mapCols);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.max(1, Math.round(cssWidth * ratio));
    const pixelHeight = Math.max(1, Math.round(cssHeight * ratio));

    if (viewerMinimap.width !== pixelWidth || viewerMinimap.height !== pixelHeight) {
      viewerMinimap.width = pixelWidth;
      viewerMinimap.height = pixelHeight;
    }

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    ctx.fillStyle = '#e6e6e6';
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    const baseScale = Math.min(cssWidth / mapCols, cssHeight / mapRows);
    const scale = baseScale * minimapZoom;
    const cameraCol = camera.position.x / cellSize;
    const cameraRow = camera.position.z / cellSize;
    const offsetX = cssWidth / 2 - cameraCol * scale;
    const offsetY = cssHeight / 2 - cameraRow * scale;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, cssWidth, cssHeight);
    ctx.clip();

    ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    ctx.lineWidth = 1;
    for (let col = 0; col <= mapCols; col += 5) {
      const x = offsetX + col * scale;
      ctx.beginPath();
      ctx.moveTo(x, offsetY);
      ctx.lineTo(x, offsetY + mapRows * scale);
      ctx.stroke();
    }
    for (let row = 0; row <= mapRows; row += 5) {
      const y = offsetY + row * scale;
      ctx.beginPath();
      ctx.moveTo(offsetX, y);
      ctx.lineTo(offsetX + mapCols * scale, y);
      ctx.stroke();
    }

    const appItems = Array.isArray(minimapSnapshot.items) ? minimapSnapshot.items : [];
    appItems.forEach((item) => {
      if (!isMinimapItemVisible(item, minimapSnapshot.showNotes)) return;
      if (typeof item.col !== 'number' || typeof item.row !== 'number') return;
      const x = offsetX + item.col * scale;
      const y = offsetY + item.row * scale;
      const w = Math.max(1, item.w || 1) * scale;
      const h = Math.max(1, item.h || 1) * scale;
      if (x > cssWidth || y > cssHeight || x + w < 0 || y + h < 0) return;
      ctx.fillStyle = getItemFill(item) === 'transparent' ? 'rgba(0,0,0,0)' : (getItemFill(item) || '#ffffff');
      ctx.strokeStyle = getItemStroke(item) === 'transparent' ? 'rgba(0,0,0,0.28)' : (getItemStroke(item) || '#222222');
      ctx.lineWidth = item.type === 'pov3d' ? 2 : 1;
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);

      if (item.text && w >= 8 && h >= 7) {
        const padding = Math.max(1.5, Math.min(5, Math.min(w, h) * 0.12));
        const textWidth = Math.max(1, w - padding * 2);
        const textHeight = Math.max(1, h - padding * 2);
        const preferredSize = Math.max(5, Math.min(14, (Number(item.textSize) || 18) * scale / 9));
        const fittedText = fitCanvasText(ctx, item.text, textWidth, textHeight, preferredSize);
        const totalTextHeight = fittedText.lines.length * fittedText.lineHeight;
        const firstBaseline = y + h / 2 - totalTextHeight / 2 + fittedText.lineHeight * 0.78;

        ctx.save();
        ctx.beginPath();
        ctx.rect(x + padding, y + padding, textWidth, textHeight);
        ctx.clip();
        ctx.fillStyle = item.textColor || '#1f4fa3';
        ctx.font = `${fittedText.fontSize}px Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        fittedText.lines.forEach((line, index) => {
          ctx.fillText(line, x + w / 2, firstBaseline + index * fittedText.lineHeight, textWidth);
        });
        ctx.restore();
      }
    });

    const markerX = offsetX + cameraCol * scale;
    const markerY = offsetY + cameraRow * scale;
    const markerSize = 9;

    ctx.save();
    ctx.translate(markerX, markerY);
    ctx.rotate(yaw);
    ctx.fillStyle = '#ff2d2d';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -markerSize);
    ctx.lineTo(markerSize * 0.68, markerSize * 0.78);
    ctx.lineTo(0, markerSize * 0.38);
    ctx.lineTo(-markerSize * 0.68, markerSize * 0.78);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    ctx.restore();
  }

  function initThree() {
    if (!canUseThree()) {
      alert('No se pudo cargar Three.js. Revisá la conexión o abrí el archivo con acceso a internet.');
      return false;
    }
    resetMovementState();
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xcfd6df);
    camera = new THREE.PerspectiveCamera(75, viewerContainer.clientWidth / viewerContainer.clientHeight, 0.1, 2000);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(viewerContainer.clientWidth, viewerContainer.clientHeight);
    viewerContainer.appendChild(renderer.domElement);

    const ambientLight = new THREE.HemisphereLight(0xffffff, 0x666666, 1.25);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.65);
    directionalLight.position.set(12, 24, 10);
    scene.add(directionalLight);

    // ground grid
    const grid = new THREE.GridHelper(320, 100, 0x565656, 0x9a9a9a);
    scene.add(grid);

    objectsGroup = new THREE.Group();
    scene.add(objectsGroup);

    // controls: we'll use pointer lock style manual controls
    controls = {
      enabled: false,
    };

    window.addEventListener('resize', onWindowResize);

    initialized = true;
    return true;
  }

  function onWindowResize() {
    if (!camera || !renderer) return;
    camera.aspect = viewerContainer.clientWidth / viewerContainer.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(viewerContainer.clientWidth, viewerContainer.clientHeight);
    drawMinimap();
  }

  function onKeyDown(event) {
    switch (event.code) {
      case 'ArrowUp':
      case 'KeyW':
        moveState.forward = true;
        break;
      case 'ArrowLeft':
      case 'KeyA':
        moveState.left = true;
        break;
      case 'ArrowDown':
      case 'KeyS':
        moveState.back = true;
        break;
      case 'ArrowRight':
      case 'KeyD':
        moveState.right = true;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        moveState.shift = true;
        break;
    }
  }

  function onKeyUp(event) {
    switch (event.code) {
      case 'ArrowUp':
      case 'KeyW':
        moveState.forward = false;
        break;
      case 'ArrowLeft':
      case 'KeyA':
        moveState.left = false;
        break;
      case 'ArrowDown':
      case 'KeyS':
        moveState.back = false;
        break;
      case 'ArrowRight':
      case 'KeyD':
        moveState.right = false;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        moveState.shift = false;
        break;
    }
  }

  let yaw = 0;
  let pitch = 0;
  function onMouseMove(e) {
    if (!document.pointerLockElement) return;
    const movementX = e.movementX || 0;
    const movementY = e.movementY || 0;
    yaw -= movementX * 0.0025;
    pitch -= movementY * 0.0025;
    const maxPitch = Math.PI / 2 - 0.01;
    pitch = Math.max(-maxPitch, Math.min(maxPitch, pitch));
    updateCameraRotation();
  }

  function updateCameraRotation() {
    camera.rotation.order = 'YXZ';
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;
  }

  function isWalkablePoint(x, z) {
    if (!collisionCells.size) return true;
    const col = Math.floor(x / cellSize);
    const row = Math.floor(z / cellSize);
    return collisionCells.has(cellKey(col, row));
  }

  function canOccupyPosition(x, z) {
    return (
      isWalkablePoint(x - playerRadius, z - playerRadius) &&
      isWalkablePoint(x + playerRadius, z - playerRadius) &&
      isWalkablePoint(x - playerRadius, z + playerRadius) &&
      isWalkablePoint(x + playerRadius, z + playerRadius) &&
      !hitsSolidObstacle(x, z)
    );
  }

  function hitsSolidObstacle(x, z) {
    return solidObstacles.some((solid) => {
      const nearestX = Math.max(solid.minX, Math.min(x, solid.maxX));
      const nearestZ = Math.max(solid.minZ, Math.min(z, solid.maxZ));
      const dx = x - nearestX;
      const dz = z - nearestZ;
      return dx * dx + dz * dz < playerRadius * playerRadius;
    });
  }

  function findFirstWalkableCameraPosition() {
    for (const cell of collisionCells.values()) {
      const x = (cell.col + 0.5) * cellSize;
      const z = (cell.row + 0.5) * cellSize;
      if (canOccupyPosition(x, z)) return { x, z };
    }
    return null;
  }

  function moveCameraWithCollision(move) {
    if (!camera) return;
    if (!collisionCells.size) {
      camera.position.add(move);
      return;
    }

    const distance = Math.sqrt(move.x * move.x + move.z * move.z);
    const steps = Math.max(1, Math.ceil(distance / (cellSize * 0.2)));
    const stepX = move.x / steps;
    const stepZ = move.z / steps;

    for (let step = 0; step < steps; step += 1) {
      const nextX = camera.position.x + stepX;
      if (canOccupyPosition(nextX, camera.position.z)) {
        camera.position.x = nextX;
      } else {
        velocity.x = 0;
      }

      const nextZ = camera.position.z + stepZ;
      if (canOccupyPosition(camera.position.x, nextZ)) {
        camera.position.z = nextZ;
      } else {
        velocity.z = 0;
      }
    }
  }

  function animate() {
    animationId = requestAnimationFrame(animate);
    if (!velocity || !direction) return;
    const time = performance.now();
    const delta = (time - prevTime) / 1000;

    velocity.x -= velocity.x * 10.0 * delta;
    velocity.z -= velocity.z * 10.0 * delta;

    direction.z = Number(moveState.forward) - Number(moveState.back);
    direction.x = Number(moveState.right) - Number(moveState.left);
    direction.normalize();

    const currentSpeed = baseMoveSpeed * (moveState.shift ? sprintMultiplier : 1);
    if (moveState.forward || moveState.back) velocity.z -= direction.z * currentSpeed * delta;
    if (moveState.left || moveState.right) velocity.x -= direction.x * currentSpeed * delta;

    // compute movement in world space based on camera yaw
    const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0,1,0), yaw);
    const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0,1,0), yaw);
    const move = new THREE.Vector3();
    move.addScaledVector(forward, -velocity.z * delta);
    move.addScaledVector(right, -velocity.x * delta);

    moveCameraWithCollision(move);

    prevTime = time;
    renderer.render(scene, camera);
    drawMinimap();
  }

  function openViewer() {
    viewerModal.hidden = false;
    if (!initialized && !initThree()) {
      viewerModal.hidden = true;
      return;
    }
    buildSceneFromItems();

    const snapshot = getEditorSnapshot();
    setupMinimap(snapshot);
    const appItems = Array.isArray(snapshot.items) ? snapshot.items : [];
    const startItem = Array.isArray(appItems)
      ? appItems.find((item) => item && item.type === 'pov3d') || appItems.find((item) => item && item.type === 'start')
      : null;

    if (startItem) {
      const centerX = (startItem.col + Math.max(1, startItem.w || 1) / 2) * cellSize;
      const centerZ = (startItem.row + Math.max(1, startItem.h || 1) / 2) * cellSize;
      camera.position.set(centerX, playerHeight, centerZ);
    } else {
      const colsValue = snapshot.grid && typeof snapshot.grid.cols === 'number' ? snapshot.grid.cols : 100;
      const rowsValue = snapshot.grid && typeof snapshot.grid.rows === 'number' ? snapshot.grid.rows : 72;
      const colsCenter = typeof colsValue === 'number' ? colsValue : 50;
      const rowsCenter = typeof rowsValue === 'number' ? rowsValue : 50;
      camera.position.set((colsCenter / 2) * cellSize, playerHeight, (rowsCenter / 2) * cellSize);
    }
    if (collisionCells.size && !canOccupyPosition(camera.position.x, camera.position.z)) {
      const firstPosition = findFirstWalkableCameraPosition();
      if (firstPosition) {
        camera.position.set(firstPosition.x, playerHeight, firstPosition.z);
      }
    }
    yaw = 0; pitch = 0; updateCameraRotation();

    prevTime = performance.now();

    // request pointer lock on click
    renderer.domElement.addEventListener('click', () => {
      if (!document.pointerLockElement) renderer.domElement.requestPointerLock();
    }, { once: true });

    document.addEventListener('pointerlockchange', onPointerLockChange);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('mousemove', onMouseMove);

    animate();
  }

  function onPointerLockChange() {
    controls.enabled = !!document.pointerLockElement;
  }

  function closeViewer() {
    viewerModal.hidden = true;
    resetMovementState();
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('keyup', onKeyUp);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('pointerlockchange', onPointerLockChange);
    window.removeEventListener('resize', onWindowResize);
    if (document.pointerLockElement) document.exitPointerLock();
    if (animationId) cancelAnimationFrame(animationId);
    animationId = null;
    minimapSnapshot = null;
    collisionCells = new Map();
    solidObstacles = [];
    // optional: dispose renderer to free GPU when closed
    if (renderer && renderer.domElement && viewerContainer.contains(renderer.domElement)) {
      viewerContainer.removeChild(renderer.domElement);
      renderer.dispose();
      renderer = null;
      camera = null;
      scene = null;
      initialized = false;
    }
  }

  // wire UI
  if (open3DBtn) open3DBtn.addEventListener('click', (e) => { e.preventDefault(); openViewer(); });
  if (close3DBtn) close3DBtn.addEventListener('click', (e) => { e.preventDefault(); closeViewer(); });

})();

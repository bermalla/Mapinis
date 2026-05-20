(function(){
  let initialized = false;
  let scene, camera, renderer, controls;
  let objectsGroup;
  let animationId = null;
  let moveState = { forward: false, back: false, left: false, right: false, shift: false };
  let velocity = null;
  let direction = null;
  let prevTime = performance.now();
  const cellSize = 3.2;
  const playerHeight = 0.55;
  const baseMoveSpeed = 30.0;
  const sprintMultiplier = 2.4;
  const blockHeight = 3.1;

  const viewerModal = document.getElementById('viewerModal');
  const viewerContainer = document.getElementById('viewerContainer');
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

  function isViewerGeometry(item, showNotes) {
    if (!item) return false;
    if (item.meta && item.meta.notes && !showNotes) return false;
    if (item.type === 'note') return false;
    if (item.type === 'pov3d') return false;
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
    if (!appItems.length) return;

    const wallThickness = 0.14;
    const ceilingMaterial = makeMaterial(0xf8f8f4, THREE.DoubleSide);
    const cellGeometry = new THREE.PlaneGeometry(cellSize, cellSize);
    const wallZGeometry = new THREE.BoxGeometry(cellSize, blockHeight, wallThickness);
    const wallXGeometry = new THREE.BoxGeometry(wallThickness, blockHeight, cellSize);
    const occupiedCells = buildOccupiedCells(appItems, snapshot.showNotes);

    occupiedCells.forEach((cell) => {
      const item = cell.item;
      const color = safeColor(getItemFill(item));
      const wallMaterial = makeMaterial(color, THREE.DoubleSide);
      const floorMaterial = makeMaterial(color, THREE.DoubleSide);
      const minX = cell.col * cellSize;
      const minZ = cell.row * cellSize;
      const centerX = minX + cellSize / 2;
      const centerZ = minZ + cellSize / 2;

      const floor = new THREE.Mesh(cellGeometry, floorMaterial);
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(centerX, 0.01, centerZ);
      objectsGroup.add(floor);

      const ceiling = new THREE.Mesh(cellGeometry, ceilingMaterial);
      ceiling.rotation.x = Math.PI / 2;
      ceiling.position.set(centerX, blockHeight - 0.01, centerZ);
      objectsGroup.add(ceiling);

      if (!occupiedCells.has(cellKey(cell.col, cell.row - 1))) {
        const northWall = new THREE.Mesh(wallZGeometry, wallMaterial);
        northWall.position.set(centerX, blockHeight / 2, minZ + wallThickness / 2);
        objectsGroup.add(northWall);
        addEdges(northWall, 0x333333);
      }

      if (!occupiedCells.has(cellKey(cell.col, cell.row + 1))) {
        const southWall = new THREE.Mesh(wallZGeometry, wallMaterial);
        southWall.position.set(centerX, blockHeight / 2, minZ + cellSize - wallThickness / 2);
        objectsGroup.add(southWall);
        addEdges(southWall, 0x333333);
      }

      if (!occupiedCells.has(cellKey(cell.col - 1, cell.row))) {
        const westWall = new THREE.Mesh(wallXGeometry, wallMaterial);
        westWall.position.set(minX + wallThickness / 2, blockHeight / 2, centerZ);
        objectsGroup.add(westWall);
        addEdges(westWall, 0x333333);
      }

      if (!occupiedCells.has(cellKey(cell.col + 1, cell.row))) {
        const eastWall = new THREE.Mesh(wallXGeometry, wallMaterial);
        eastWall.position.set(minX + cellSize - wallThickness / 2, blockHeight / 2, centerZ);
        objectsGroup.add(eastWall);
        addEdges(eastWall, 0x333333);
      }
    });
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

    camera.position.add(move);

    prevTime = time;
    renderer.render(scene, camera);
  }

  function openViewer() {
    viewerModal.hidden = false;
    if (!initialized && !initThree()) {
      viewerModal.hidden = true;
      return;
    }
    buildSceneFromItems();

    const snapshot = getEditorSnapshot();
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

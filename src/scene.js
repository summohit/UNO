import * as THREE from 'three';
import { gsap } from 'gsap';
import {
  COLOR_PALETTE,
  getCardFaceTexture,
  getCardBackTexture,
  createTableFeltTexture,
} from './textures.js';

export class Uno3DArena {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.scene.background = null; // Transparent so cosmic floating-card backdrop shines behind 3D table

    this.camera = new THREE.PerspectiveCamera(
      46,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    this.baseCamPos = new THREE.Vector3(0, 8.6, 8.8);
    this.baseLookAt = new THREE.Vector3(0, 0.15, 0.9);
    this.currentLookAt = this.baseLookAt.clone();

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this.cardGeometry = new THREE.BoxGeometry(1.06, 1.56, 0.016);
    this.edgeMaterial = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.35,
    });
    this.backMaterial = new THREE.MeshStandardMaterial({
      map: getCardBackTexture(),
      roughness: 0.25,
      metalness: 0.08,
    });

    this.direction = 1; // 1 = clockwise, -1 = counter-clockwise
    this.ringRotationSpeed = 0.75;
    this.particles = [];
    this.shockwaves = [];
    this.botTotems = [];
    this.clock = new THREE.Clock();

    this._setupLights();
    this._setupTable();
    this._setupDirectionRing();
    this._setupBotTotems();
    this._updateCameraForAspect();

    window.addEventListener('resize', () => this._onResize());
  }

  _setupLights() {
    const ambient = new THREE.AmbientLight(0xdbeafe, 0.75);
    this.scene.add(ambient);

    const mainSpot = new THREE.SpotLight(0xfffbeb, 55);
    mainSpot.position.set(0, 12, 3);
    mainSpot.angle = Math.PI / 3.2;
    mainSpot.penumbra = 0.65;
    mainSpot.decay = 1.3;
    mainSpot.distance = 32;
    mainSpot.castShadow = true;
    mainSpot.shadow.mapSize.width = 2048;
    mainSpot.shadow.mapSize.height = 2048;
    mainSpot.shadow.bias = -0.0005;
    this.scene.add(mainSpot);

    // Dynamic color-reactive center table light
    this.colorLight = new THREE.PointLight(0xef233c, 5.5, 10, 1.5);
    this.colorLight.position.set(0, 1.8, 0);
    this.scene.add(this.colorLight);

    // Dynamic Turn-Focus Spotlight that glides to the active player's 3D seat
    this.turnFocusLight = new THREE.PointLight(0xfacc15, 6.5, 9, 1.6);
    this.turnFocusLight.position.set(0, 2.8, 4.2);
    this.scene.add(this.turnFocusLight);

    // Rim backlight
    const rimLight = new THREE.DirectionalLight(0x60a5fa, 1.4);
    rimLight.position.set(-6, 5, -7);
    this.scene.add(rimLight);
  }

  _setupTable() {
    this.tableGroup = new THREE.Group();
    this.scene.add(this.tableGroup);

    // Felt playing surface
    const feltGeo = new THREE.CylinderGeometry(5.6, 5.6, 0.28, 64);
    const feltMat = new THREE.MeshStandardMaterial({
      map: createTableFeltTexture(),
      roughness: 0.78,
      metalness: 0.05,
    });
    const feltMesh = new THREE.Mesh(feltGeo, feltMat);
    feltMesh.position.y = -0.14;
    feltMesh.receiveShadow = true;
    this.tableGroup.add(feltMesh);

    // Beveled dark wood/carbon rim
    const rimGeo = new THREE.TorusGeometry(5.65, 0.34, 24, 72);
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0x1e1b2e,
      roughness: 0.25,
      metalness: 0.55,
    });
    const rimMesh = new THREE.Mesh(rimGeo, rimMat);
    rimMesh.rotation.x = Math.PI / 2;
    rimMesh.position.y = 0.02;
    rimMesh.castShadow = true;
    rimMesh.receiveShadow = true;
    this.tableGroup.add(rimMesh);

    // Neon cyan inner edge light ring
    const neonInnerGeo = new THREE.TorusGeometry(5.32, 0.048, 16, 80);
    const neonInnerMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      roughness: 0.15,
      metalness: 0.4,
      emissive: 0x38bdf8,
      emissiveIntensity: 1.9,
    });
    const neonInner = new THREE.Mesh(neonInnerGeo, neonInnerMat);
    neonInner.rotation.x = Math.PI / 2;
    neonInner.position.y = 0.04;
    this.tableGroup.add(neonInner);

    // Outer violet/magenta accent rim halo
    const neonOuterGeo = new THREE.TorusGeometry(5.96, 0.045, 16, 80);
    const neonOuterMat = new THREE.MeshStandardMaterial({
      color: 0xa855f7,
      roughness: 0.2,
      metalness: 0.5,
      emissive: 0x9333ea,
      emissiveIntensity: 1.5,
    });
    const neonOuter = new THREE.Mesh(neonOuterGeo, neonOuterMat);
    neonOuter.rotation.x = Math.PI / 2;
    neonOuter.position.y = 0.02;
    this.tableGroup.add(neonOuter);

    // Subtle starry background dust particles
    const starCount = 120;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      starPositions[i * 3] = (Math.random() - 0.5) * 26;
      starPositions[i * 3 + 1] = (Math.random() - 0.2) * 10;
      starPositions[i * 3 + 2] = (Math.random() - 0.5) * 24 - 2;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0x93c5fd,
      size: 0.09,
      transparent: true,
      opacity: 0.55,
    });
    this.scene.add(new THREE.Points(starGeo, starMat));

    // Center discard pedestal pad
    const padGeo = new THREE.CylinderGeometry(1.25, 1.35, 0.04, 48);
    const padMat = new THREE.MeshStandardMaterial({
      color: 0x0b1633,
      roughness: 0.3,
      metalness: 0.65,
    });
    const padMesh = new THREE.Mesh(padGeo, padMat);
    padMesh.position.set(0.55, 0.015, -0.15);
    padMesh.receiveShadow = true;
    this.tableGroup.add(padMesh);
  }

  _setupDirectionRing() {
    this.ringGroup = new THREE.Group();
    this.ringGroup.position.set(0.55, 0.035, -0.15);
    this.scene.add(this.ringGroup);

    // Glowing segmented outer ring
    const ringGeo = new THREE.TorusGeometry(1.62, 0.035, 16, 64);
    this.ringMat = new THREE.MeshStandardMaterial({
      color: 0xef233c,
      emissive: 0xef233c,
      emissiveIntensity: 1.4,
      roughness: 0.2,
    });
    const ringMesh = new THREE.Mesh(ringGeo, this.ringMat);
    ringMesh.rotation.x = Math.PI / 2;
    this.ringGroup.add(ringMesh);

    // 4 directional 3D arrow fins around the ring
    this.arrowMeshes = [];
    const coneGeo = new THREE.ConeGeometry(0.13, 0.34, 12);
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2;
      const arrow = new THREE.Mesh(coneGeo, this.ringMat);
      arrow.position.set(Math.cos(angle) * 1.62, 0.02, Math.sin(angle) * 1.62);
      arrow.rotation.x = Math.PI / 2;
      arrow.rotation.z = -angle;
      this.ringGroup.add(arrow);
      this.arrowMeshes.push({ mesh: arrow, angle });
    }
  }

  _setupBotTotems() {
    // 3 stylized glossy 3D bot characters around the table: Left (1), Top (2), Right (3)
    const botConfigs = [
      { id: 1, name: 'Nova', pos: new THREE.Vector3(-4.85, 0.72, -0.35), color: 0x0ea5e9 },
      { id: 2, name: 'Apex', pos: new THREE.Vector3(0, 0.72, -4.85), color: 0xa855f7 },
      { id: 3, name: 'Blaze', pos: new THREE.Vector3(4.85, 0.72, -0.35), color: 0xf97316 },
    ];

    botConfigs.forEach((cfg) => {
      const group = new THREE.Group();
      group.position.copy(cfg.pos);
      group.lookAt(0, 0.65, 0);

      // Glowing circular pedestal base
      const baseGeo = new THREE.CylinderGeometry(0.52, 0.58, 0.08, 32);
      const baseMat = new THREE.MeshStandardMaterial({
        color: 0x0f172a,
        roughness: 0.2,
        metalness: 0.7,
        emissive: cfg.color,
        emissiveIntensity: 0.35,
      });
      const baseMesh = new THREE.Mesh(baseGeo, baseMat);
      baseMesh.position.y = -0.52;
      group.add(baseMesh);

      // Glossy rounded 3D sphere torso (matching screenshot bot totems)
      const bodyGeo = new THREE.SphereGeometry(0.42, 32, 32);
      const bodyMat = new THREE.MeshStandardMaterial({
        color: cfg.color,
        roughness: 0.14,
        metalness: 0.35,
        emissive: cfg.color,
        emissiveIntensity: 0.28,
      });
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.position.y = -0.05;
      body.castShadow = true;
      group.add(body);

      // Glossy dark round head
      const headGeo = new THREE.SphereGeometry(0.28, 28, 28);
      const headMat = new THREE.MeshStandardMaterial({
        color: 0x0b1120,
        roughness: 0.12,
        metalness: 0.75,
      });
      const head = new THREE.Mesh(headGeo, headMat);
      head.position.y = 0.52;
      head.castShadow = true;
      group.add(head);

      // Cute top antenna stem & glowing orb
      const antStemGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.18, 12);
      const antStem = new THREE.Mesh(antStemGeo, bodyMat);
      antStem.position.y = 0.86;
      group.add(antStem);

      const antOrbGeo = new THREE.SphereGeometry(0.055, 16, 16);
      const antOrbMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: cfg.color,
        emissiveIntensity: 2.2,
      });
      const antOrb = new THREE.Mesh(antOrbGeo, antOrbMat);
      antOrb.position.y = 0.96;
      group.add(antOrb);

      // Two glowing round eyes
      const eyeGeo = new THREE.SphereGeometry(0.048, 16, 16);
      const visorMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: cfg.color,
        emissiveIntensity: 2.4,
      });
      const leftEye = new THREE.Mesh(eyeGeo, visorMat);
      leftEye.position.set(-0.09, 0.54, 0.24);
      const rightEye = new THREE.Mesh(eyeGeo, visorMat);
      rightEye.position.set(0.09, 0.54, 0.24);
      group.add(leftEye, rightEye);

      // Active turn halo ring under totem
      const haloGeo = new THREE.TorusGeometry(0.62, 0.035, 12, 36);
      const haloMat = new THREE.MeshStandardMaterial({
        color: 0xfacc15,
        emissive: 0xfacc15,
        emissiveIntensity: 1.8,
        transparent: true,
        opacity: 0,
      });
      const halo = new THREE.Mesh(haloGeo, haloMat);
      halo.rotation.x = Math.PI / 2;
      halo.position.y = -0.48;
      group.add(halo);

      this.scene.add(group);
      this.botTotems.push({
        id: cfg.id,
        group,
        body,
        bodyMat,
        head,
        headMat,
        visorMat,
        haloMat,
        baseY: cfg.pos.y,
        occupied: true,
      });
    });
  }

  setSeatOccupiedVisual(visualSlot, isOccupied) {
    const totem = this.botTotems.find((t) => t.id === visualSlot);
    if (!totem) return;
    totem.occupied = isOccupied;
    totem.bodyMat.transparent = true;
    totem.headMat.transparent = true;
    totem.visorMat.transparent = true;

    gsap.to(totem.group.scale, {
      x: isOccupied ? 1 : 0.42,
      y: isOccupied ? 1 : 0.42,
      z: isOccupied ? 1 : 0.42,
      duration: 0.4,
      ease: 'back.out(1.6)',
    });
    gsap.to([totem.bodyMat, totem.headMat, totem.visorMat], {
      opacity: isOccupied ? 1 : 0.18,
      duration: 0.35,
    });
  }

  setArenaLevelTheme(levelNumber) {
    const shell = document.getElementById('app-shell');
    if (shell) {
      shell.dataset.arenaLevel = String(levelNumber);
    }
  }

  createCardMesh(cardData) {
    const faceTex = getCardFaceTexture(cardData.color, cardData.value);
    const faceMat = new THREE.MeshStandardMaterial({
      map: faceTex,
      roughness: 0.22,
      metalness: 0.06,
    });

    // BoxGeometry faces: +x, -x, +y, -y, +z (front face), -z (back face)
    const materials = [
      this.edgeMaterial,
      this.edgeMaterial,
      this.edgeMaterial,
      this.edgeMaterial,
      faceMat,
      this.backMaterial,
    ];

    const mesh = new THREE.Mesh(this.cardGeometry, materials);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.card = cardData;
    return mesh;
  }

  setActiveColorVisual(colorKey) {
    const pal = COLOR_PALETTE[colorKey] || COLOR_PALETTE.wild;
    const targetColor = new THREE.Color(pal.three);

    gsap.to(this.ringMat.color, {
      r: targetColor.r,
      g: targetColor.g,
      b: targetColor.b,
      duration: 0.45,
    });
    gsap.to(this.ringMat.emissive, {
      r: targetColor.r,
      g: targetColor.g,
      b: targetColor.b,
      duration: 0.45,
    });
    gsap.to(this.colorLight.color, {
      r: targetColor.r,
      g: targetColor.g,
      b: targetColor.b,
      duration: 0.45,
    });
  }

  setDirectionVisual(direction) {
    this.direction = direction;
    this.arrowMeshes.forEach(({ mesh, angle }) => {
      mesh.rotation.z = direction === 1 ? -angle : -angle + Math.PI;
    });
    // Pulse the ring in 3D on reverse
    gsap.fromTo(
      this.ringGroup.scale,
      { x: 1.38, y: 1.38, z: 1.38 },
      { x: 1, y: 1, z: 1, duration: 0.65, ease: 'elastic.out(1, 0.4)' }
    );
  }

  highlightTurnPlayer(playerIndex) {
    // Glide 3D turn spotlight & subtle camera gaze toward the active player's seat
    const focusTargets = {
      0: { light: { x: 0, y: 3.1, z: 4.5 }, look: { x: 0, y: this.baseLookAt.y, z: this.baseLookAt.z } },
      1: { light: { x: -4.4, y: 2.6, z: -0.35 }, look: { x: -0.55, y: this.baseLookAt.y, z: this.baseLookAt.z - 0.15 } },
      2: { light: { x: 0, y: 2.6, z: -4.4 }, look: { x: 0, y: this.baseLookAt.y, z: this.baseLookAt.z - 0.55 } },
      3: { light: { x: 4.4, y: 2.6, z: -0.35 }, look: { x: 0.55, y: this.baseLookAt.y, z: this.baseLookAt.z - 0.15 } },
    };
    const target = focusTargets[playerIndex] || focusTargets[0];

    if (this.turnFocusLight) {
      gsap.to(this.turnFocusLight.position, {
        x: target.light.x,
        y: target.light.y,
        z: target.light.z,
        duration: 0.55,
        ease: 'power2.out',
      });
    }

    gsap.to(this.currentLookAt, {
      x: target.look.x,
      y: target.look.y,
      z: target.look.z,
      duration: 0.6,
      ease: 'power2.out',
    });

    const hasActiveTurn = playerIndex >= 0;
    this.botTotems.forEach((totem) => {
      if (!totem.occupied) return;
      const isTurn = totem.id === playerIndex;
      totem.bodyMat.transparent = true;
      totem.headMat.transparent = true;
      totem.visorMat.transparent = true;

      gsap.to(totem.haloMat, {
        opacity: isTurn ? 1 : 0,
        duration: 0.3,
      });
      gsap.to(totem.group.scale, {
        x: isTurn ? 1.24 : hasActiveTurn ? 0.86 : 1,
        y: isTurn ? 1.24 : hasActiveTurn ? 0.86 : 1,
        z: isTurn ? 1.24 : hasActiveTurn ? 0.86 : 1,
        duration: 0.38,
        ease: 'back.out(1.6)',
      });
      gsap.to([totem.bodyMat, totem.headMat, totem.visorMat], {
        opacity: isTurn || !hasActiveTurn ? 1 : 0.42,
        duration: 0.35,
      });
    });
  }

  animateBotReaction(botIndex, type = 'hit') {
    const totem = this.botTotems.find((t) => t.id === botIndex);
    if (!totem) return;
    if (type === 'hit') {
      gsap.fromTo(
        totem.group.rotation,
        { z: -0.35 },
        { z: 0, duration: 0.6, ease: 'elastic.out(1.2, 0.25)' }
      );
    } else {
      gsap.to(totem.group.position, {
        y: totem.baseY + 0.45,
        duration: 0.18,
        yoyo: true,
        repeat: 1,
      });
    }
  }

  triggerShockwave(colorKey = 'red', power = 1) {
    const pal = COLOR_PALETTE[colorKey] || COLOR_PALETTE.wild;
    const center = new THREE.Vector3(0.55, 0.12, -0.15);

    // Expanding 3D shockwave ring
    const waveGeo = new THREE.RingGeometry(0.4, 0.72, 48);
    const waveMat = new THREE.MeshBasicMaterial({
      color: pal.three,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.92,
    });
    const waveMesh = new THREE.Mesh(waveGeo, waveMat);
    waveMesh.rotation.x = -Math.PI / 2;
    waveMesh.position.copy(center);
    this.scene.add(waveMesh);

    const maxScale = 4.2 * power;
    gsap.to(waveMesh.scale, {
      x: maxScale,
      y: maxScale,
      z: maxScale,
      duration: 0.65,
      ease: 'power2.out',
    });
    gsap.to(waveMat, {
      opacity: 0,
      duration: 0.65,
      ease: 'power2.out',
      onComplete: () => {
        this.scene.remove(waveMesh);
        waveGeo.dispose();
        waveMat.dispose();
      },
    });

    // 3D Particle burst with gravity & bounce
    const count = Math.floor(42 * power);
    const partGeo = new THREE.OctahedronGeometry(0.085, 0);
    for (let i = 0; i < count; i++) {
      const partMat = new THREE.MeshBasicMaterial({
        color: i % 3 === 0 ? 0xffffff : pal.three,
        transparent: true,
        opacity: 1,
      });
      const p = new THREE.Mesh(partGeo, partMat);
      p.position.copy(center);

      const angle = Math.random() * Math.PI * 2;
      const speed = (2.4 + Math.random() * 4.8) * power;
      p.userData.vel = new THREE.Vector3(
        Math.cos(angle) * speed,
        3.2 + Math.random() * 4.5 * power,
        Math.sin(angle) * speed
      );
      p.userData.life = 1.0;
      this.scene.add(p);
      this.particles.push(p);
    }
  }

  cameraPunch(intensity = 1) {
    gsap.killTweensOf(this.camera.position);
    const orig = this.baseCamPos.clone();

    const tl = gsap.timeline();
    tl.to(this.camera.position, {
      x: orig.x + (Math.random() - 0.5) * 0.45 * intensity,
      y: orig.y - 0.75 * intensity,
      z: orig.z - 0.95 * intensity,
      duration: 0.14,
      ease: 'power2.out',
    }).to(this.camera.position, {
      x: orig.x,
      y: orig.y,
      z: orig.z,
      duration: 0.55,
      ease: 'elastic.out(1, 0.35)',
    });
  }

  _updateCameraForAspect() {
    const aspect = window.innerWidth / window.innerHeight;
    // Adapt camera distance for portrait mobile screens vs landscape
    if (aspect < 0.75) {
      this.camera.fov = 54;
      this.baseCamPos.set(0, 10.6, 10.4);
      this.baseLookAt.set(0, -0.2, 1.35);
    } else if (aspect < 1.1) {
      this.camera.fov = 50;
      this.baseCamPos.set(0, 9.6, 9.5);
      this.baseLookAt.set(0, 0, 1.1);
    } else {
      this.camera.fov = 45;
      this.baseCamPos.set(0, 8.2, 8.3);
      this.baseLookAt.set(0, 0.1, 0.85);
    }
    this.camera.position.copy(this.baseCamPos);
    this.currentLookAt.copy(this.baseLookAt);
    this.camera.lookAt(this.currentLookAt);
    this.camera.updateProjectionMatrix();
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this._updateCameraForAspect();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  pickCard(clientX, clientY, interactableMeshes) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(interactableMeshes, false);
    return hits.length > 0 ? hits[0].object : null;
  }

  startRenderLoop(onTick) {
    const animate = () => {
      requestAnimationFrame(animate);
      const dt = Math.min(this.clock.getDelta(), 0.05);
      const elapsed = this.clock.getElapsedTime();

      // Spin 3D direction ring
      this.ringGroup.rotation.y -= this.direction * this.ringRotationSpeed * dt;

      // Floating idle animation for 3D bot totems
      this.botTotems.forEach((totem, idx) => {
        totem.body.rotation.y = elapsed * 0.9 + idx;
        totem.head.position.y = 0.56 + Math.sin(elapsed * 2.5 + idx) * 0.05;
      });

      // Update 3D particles
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.userData.vel.y -= 13.5 * dt; // gravity
        p.position.addScaledVector(p.userData.vel, dt);
        if (p.position.y < 0.06) {
          p.position.y = 0.06;
          p.userData.vel.y *= -0.55; // table bounce
        }
        p.rotation.x += 5 * dt;
        p.rotation.y += 6 * dt;
        p.userData.life -= 1.45 * dt;
        p.material.opacity = Math.max(0, p.userData.life);

        if (p.userData.life <= 0) {
          this.scene.remove(p);
          p.material.dispose();
          this.particles.splice(i, 1);
        }
      }

      this.camera.lookAt(this.currentLookAt);
      if (onTick) onTick(dt, elapsed);
      this.renderer.render(this.scene, this.camera);
    };
    animate();
  }
}

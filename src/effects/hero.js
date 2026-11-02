import * as THREE from 'three';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { isMobile, pixelRatio, disposeScene, fontBold, fontRegular, globalPointer } from './shared.js';
const NUMBER_BASE_ROT_X = -.12, NUMBER_BASE_ROT_Y = .55, NUMBER_AUTO_ROT_SPEED = .42;
const NUMBER_ROT_MAX_X = Math.PI*.35, NUMBER_ROT_MAX_Y = Math.PI*.55;
// Let the rotating silhouette slightly exceed the box for a fuller desktop composition.
const fittedDistance = (camera, radius) => radius / Math.sin(Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.10 * Math.min(1, camera.aspect)));
const getHelvetikerRegular = () => Promise.resolve(fontRegular);
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { AsciiEffect } from './ascii.js';
    function createNumber3(cellEl) {
      let fitRadius = 1;
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x000000);
      const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
      camera.position.set(0, 0, 2.2);

      scene.add(new THREE.AmbientLight(0x334455, 1.0));
      const d = new THREE.DirectionalLight(0xffffff, 1.0);
      d.position.set(2, 2, 3);
      scene.add(d);

      const group = new THREE.Group();
      scene.add(group);
      group.rotation.set(NUMBER_BASE_ROT_X, NUMBER_BASE_ROT_Y, 0);

      const loader = { load: (_url, callback) => callback(fontBold) };
      loader.load('',
        (font) => {
          const geo = new TextGeometry('3', {
            font,
            size: 1.4,
            depth: 0.4,
            curveSegments: 8,
            bevelEnabled: true,
            bevelThickness: 0.03,
            bevelSize: 0.02,
            bevelSegments: 2,
          });
          geo.center();
          geo.computeBoundingSphere();fitRadius=geo.boundingSphere.radius;
          const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
          const mesh = new THREE.Mesh(geo, mat);
          group.add(mesh);
        }
      );

      const localRenderer = new THREE.WebGLRenderer({ antialias: !isMobile(), alpha: false });
      localRenderer.outputColorSpace = THREE.SRGBColorSpace;
      localRenderer.toneMapping = THREE.NoToneMapping;
      localRenderer.setClearColor(0x000000, 1);
      localRenderer.setPixelRatio(pixelRatio());

      const normalChars = '321 ';
      const ZOOM_IDLE_Z = 1.35;
      const ZOOM_ACTIVE_Z = 0.6;
      const ZOOM_DURATION = 1.0;
      const ASCII_TRANSITION_DURATION = 1.0;

      const hoverState = {
        progress: 0,
        pendingTarget: 0,
        currentTarget: 0,
        startProgress: 0,
        transitionStart: null,
        transitionQueued: false
      };

      const asciiPalette = ['#024b9e', '#217adf', '#72b4ff'];

      const effect = new AsciiEffect(localRenderer, normalChars, {
        invert: false,
        colorPalette: asciiPalette,
        stageReplacementChars: ['2', '1', '0']
      });

      let asciiProgress = 0;
      let lastAsciiUpdateTime = null;
      let width = 1;
      let height = 1;
      let disposed = false;
      let eventsBound = false;

      const pointerWithinCell = () => globalPointer.active && globalPointer.cell === cellEl;

      const applyEffectStyles = (dom) => {
        if (!dom) return;
        dom.style.position = 'absolute';
        dom.style.inset = '0';
        dom.style.width = '100%';
        dom.style.height = '100%';
        dom.style.backgroundColor = '#deefff';
        dom.style.color = asciiPalette[0];
        dom.style.userSelect = 'none';
        dom.style.touchAction = 'pan-y';
        dom.style.cursor = 'default';
        dom.style.pointerEvents = 'auto';
      };

      const queueHoverTransition = (target) => {
        if (hoverState.pendingTarget !== target) {
          hoverState.pendingTarget = target;
          hoverState.transitionQueued = true;
        } else if (!hoverState.transitionQueued && hoverState.currentTarget !== target) {
          hoverState.transitionQueued = true;
        }
      };

      const handleEnter = () => { queueHoverTransition(1); };
      const handleLeave = () => { queueHoverTransition(0); };
      const handleWindowPointerOut = (e) => { if (!e.relatedTarget) handleLeave(); };
      const handleWindowBlur = () => { handleLeave(); };

      const bindCellEvents = () => {
        if (!cellEl || eventsBound) return;
        if (!cellEl.style.position) cellEl.style.position = 'relative';
        cellEl.addEventListener('pointerenter', handleEnter);
        cellEl.addEventListener('pointerleave', handleLeave);
        cellEl.addEventListener('pointercancel', handleLeave);
        cellEl.addEventListener('mouseenter', handleEnter);
        cellEl.addEventListener('mouseleave', handleLeave);
        window.addEventListener('pointerout', handleWindowPointerOut, { passive: true });
        window.addEventListener('blur', handleWindowBlur);
        eventsBound = true;
      };

      const unbindCellEvents = () => {
        if (!cellEl || !eventsBound) return;
        cellEl.removeEventListener('pointerenter', handleEnter);
        cellEl.removeEventListener('pointerleave', handleLeave);
        cellEl.removeEventListener('pointercancel', handleLeave);
        cellEl.removeEventListener('mouseenter', handleEnter);
        cellEl.removeEventListener('mouseleave', handleLeave);
        window.removeEventListener('pointerout', handleWindowPointerOut, { passive: true });
        window.removeEventListener('blur', handleWindowBlur);
        eventsBound = false;
      };

      applyEffectStyles(effect.domElement);
      effect.domElement.classList.add('ascii-effect');
      effect.domElement.addEventListener('pointerenter', handleEnter);
      effect.domElement.addEventListener('pointerleave', handleLeave);
      effect.domElement.addEventListener('pointercancel', handleLeave);
      effect.domElement.addEventListener('mouseenter', handleEnter);
      effect.domElement.addEventListener('mouseleave', handleLeave);

      if (cellEl) {
        bindCellEvents();
        cellEl.appendChild(effect.domElement);
      }

      const pointerRot = { currentX: 0, currentY: 0 };

      function update(t = 0) {
        const inside = pointerWithinCell();
        if (inside) {
          queueHoverTransition(1);
        } else {
          queueHoverTransition(0);
        }

        if (hoverState.transitionQueued) {
          hoverState.transitionQueued = false;
          if (hoverState.currentTarget !== hoverState.pendingTarget) {
            hoverState.startProgress = hoverState.progress;
            hoverState.currentTarget = hoverState.pendingTarget;
            hoverState.transitionStart = t;
          }
        }

        if (hoverState.transitionStart !== null) {
          const elapsed = Math.max(0, t - hoverState.transitionStart);
          const raw = ZOOM_DURATION <= 0 ? 1 : Math.min(1, elapsed / ZOOM_DURATION);
          const eased = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2;
          hoverState.progress = THREE.MathUtils.lerp(hoverState.startProgress, hoverState.currentTarget, eased);
          if (raw >= 1) {
            hoverState.progress = hoverState.currentTarget;
            hoverState.startProgress = hoverState.progress;
            hoverState.transitionStart = null;
          }
        } else {
          hoverState.progress = hoverState.currentTarget;
        }

        const progress = THREE.MathUtils.clamp(hoverState.progress, 0, 1);

        const dt = lastAsciiUpdateTime === null ? 0 : Math.max(0, Math.min(0.2, t - lastAsciiUpdateTime));
        lastAsciiUpdateTime = t;

        const asciiTarget = hoverState.currentTarget;
        if (asciiProgress !== asciiTarget) {
          const direction = asciiTarget > asciiProgress ? 1 : -1;
          asciiProgress += direction * (dt / ASCII_TRANSITION_DURATION);
          if ((direction > 0 && asciiProgress > asciiTarget) || (direction < 0 && asciiProgress < asciiTarget)) {
            asciiProgress = asciiTarget;
          }
        }
        asciiProgress = THREE.MathUtils.clamp(asciiProgress, 0, 1);

        effect.setTransitionProgress(asciiProgress);

        const zoomZ = THREE.MathUtils.lerp(ZOOM_IDLE_Z, ZOOM_ACTIVE_Z, progress);
        camera.position.z = isMobile() ? zoomZ / Math.min(1, camera.aspect) : fittedDistance(camera,fitRadius) * THREE.MathUtils.lerp(1.08, .46, progress);
        const active = globalPointer.active;
        const targetY = active ? THREE.MathUtils.clamp(globalPointer.nx * NUMBER_ROT_MAX_Y, -NUMBER_ROT_MAX_Y, NUMBER_ROT_MAX_Y) : 0;
        const targetX = active ? THREE.MathUtils.clamp(-globalPointer.ny * NUMBER_ROT_MAX_X, -NUMBER_ROT_MAX_X, NUMBER_ROT_MAX_X) : 0;
        const ease = active ? 0.18 : 0.12;
        pointerRot.currentX += (targetX - pointerRot.currentX) * ease;
        pointerRot.currentY += (targetY - pointerRot.currentY) * ease;
        const baseY = NUMBER_BASE_ROT_Y + t * NUMBER_AUTO_ROT_SPEED;
        group.rotation.y = baseY + pointerRot.currentY;
        group.rotation.x = NUMBER_BASE_ROT_X + pointerRot.currentX;
      }

      return {
        resize(newWidth, newHeight) {
          width = Math.max(1, Math.floor(newWidth));
          height = Math.max(1, Math.floor(newHeight));
          localRenderer.setPixelRatio(pixelRatio());
          localRenderer.setSize(width, height, false);
          camera.aspect = width / height;
          camera.position.z = isMobile() ? 1.35 / Math.min(1, camera.aspect) : fittedDistance(camera,fitRadius);
          camera.updateProjectionMatrix();
          effect.setSize(width, height);
        },
        tick(time) {
          if (disposed) return;
          update(time);
          effect.render(scene, camera);
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          unbindCellEvents();
          effect.domElement.removeEventListener('pointerenter', handleEnter);
          effect.domElement.removeEventListener('pointerleave', handleLeave);
          effect.domElement.removeEventListener('pointercancel', handleLeave);
          effect.domElement.removeEventListener('mouseenter', handleEnter);
          effect.domElement.removeEventListener('mouseleave', handleLeave);
          if (effect.domElement.parentNode) {
            effect.domElement.parentNode.removeChild(effect.domElement);
          }
          disposeScene(scene);
          localRenderer.dispose(); localRenderer.forceContextLoss();
        }
      };
    }



    function createNumber2(cellEl) {
      let fitRadius = 1;
      let spreadX=1,spreadY=1,spreadZ=1;
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
      camera.position.set(0, 0, 2.2);

      scene.add(new THREE.AmbientLight(0x334455, 1.0));
      const d = new THREE.DirectionalLight(0xffffff, 1.3);
      d.position.set(2, 2, 3);
      scene.add(d);

      const group = new THREE.Group();
      scene.add(group);
      group.rotation.set(NUMBER_BASE_ROT_X, NUMBER_BASE_ROT_Y, 0);

      const renderer = new THREE.WebGLRenderer({ antialias: !isMobile(), alpha: true });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.setClearColor(0xdeefff, 0);
      renderer.setPixelRatio(pixelRatio());

      const canvasEl = renderer.domElement;
      canvasEl.style.width = '100%';
      canvasEl.style.height = '100%';
      canvasEl.style.display = 'block';
      canvasEl.style.touchAction = 'pan-y';

      if (cellEl) {
        cellEl.appendChild(canvasEl);
        cellEl.style.userSelect = 'none';
        cellEl.style.touchAction = 'pan-y';
        cellEl.style.cursor = 'default';
      }

      const COUNT = isMobile() ? 1200 : 2000;
      let targetPoints = null;
      let scatter = false;
      let disposed = false;

      const pg = new THREE.BufferGeometry();
      const positions = new Float32Array(COUNT * 3);
      const velocities = new Float32Array(COUNT * 3);
      const colors = new Float32Array(COUNT * 3);
      const palette = ['#024b9e', '#217adf', '#72b4ff'].map((hex) => new THREE.Color(hex));

      for (let i = 0; i < COUNT; i++) {
        const r = Math.cbrt(Math.random()) * 0.8;
        const th = Math.random() * Math.PI * 2;
        const ph = Math.acos(2 * Math.random() - 1);
        const x = r * Math.sin(ph) * Math.cos(th);
        const y = r * Math.sin(ph) * Math.sin(th);
        const z = r * Math.cos(ph);
        const idx = i * 3;
        positions[idx] = x;
        positions[idx + 1] = y;
        positions[idx + 2] = z;
        // Precompute the burst once; no per-frame random generation or extra particles.
        const burstScale = 0.9 / Math.max(r, 0.001);
        velocities[idx] = x * burstScale;
        velocities[idx + 1] = y * burstScale;
        velocities[idx + 2] = z * burstScale;
        palette[Math.floor(Math.random() * palette.length)].toArray(colors, idx);
      }

      pg.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      pg.setAttribute('color', new THREE.BufferAttribute(colors, 3));

      const pm = new THREE.PointsMaterial({ size: 0.05, sizeAttenuation: true, vertexColors: true });
      const points = new THREE.Points(pg, pm);
      group.add(points);

      const loader = { load: (_url, callback) => callback(fontBold) };
      loader.load('',
        (font) => {
          const geo = new TextGeometry('2', {
            font,
            size: 1.4,
            depth: 0.4,
            curveSegments: 8,
            bevelEnabled: true,
            bevelThickness: 0.03,
            bevelSize: 0.02,
            bevelSegments: 2,
          });
          geo.center();
          geo.computeBoundingSphere();fitRadius=geo.boundingSphere.radius;
          geo.computeVertexNormals();
          targetPoints = samplePointsOnGeometrySurface(geo, COUNT);
          positions.set(targetPoints);
          const mat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            metalness: 0.75,
            roughness: 0.25,
            visible: false
          });
          const mesh = new THREE.Mesh(geo, mat);
          group.add(mesh);
        }
      );

      const handlePointerEnter = (event) => { if (event.pointerType === 'mouse') scatter = true; };
      const handlePointerLeave = () => { scatter = false; };

      if (cellEl) {
        cellEl.addEventListener('pointerenter', handlePointerEnter);
        cellEl.addEventListener('pointerleave', handlePointerLeave);
        cellEl.addEventListener('pointercancel', handlePointerLeave);
      }

      const pointerRot = { currentX: 0, currentY: 0 };

      let previousTime = null;
      function update(t) {
        const active = globalPointer.active;
        const targetY = active ? THREE.MathUtils.clamp(globalPointer.nx * NUMBER_ROT_MAX_Y, -NUMBER_ROT_MAX_Y, NUMBER_ROT_MAX_Y) : 0;
        const targetX = active ? THREE.MathUtils.clamp(-globalPointer.ny * NUMBER_ROT_MAX_X, -NUMBER_ROT_MAX_X, NUMBER_ROT_MAX_X) : 0;
        const ease = active ? 0.16 : 0.1;
        pointerRot.currentX += (targetX - pointerRot.currentX) * ease;
        pointerRot.currentY += (targetY - pointerRot.currentY) * ease;
        const baseY = NUMBER_BASE_ROT_Y + t * NUMBER_AUTO_ROT_SPEED;
        group.rotation.y = baseY + pointerRot.currentY;
        group.rotation.x = NUMBER_BASE_ROT_X + pointerRot.currentX;

        const pos = pg.attributes.position.array;
        if (!targetPoints) return;

        const dt = previousTime === null ? 1 / 60 : Math.min(.05, Math.max(0, t - previousTime));
        previousTime = t;
        // Reach 90% of the burst in ~1 second, independently of 30/60 fps.
        const blend = 1 - Math.exp(-dt * (scatter ? 2.3 : 10));
        for (let i = 0; i < pos.length; i++) {
          const spread = i % 3 === 0 ? spreadX : i % 3 === 1 ? spreadY : spreadZ;
          const destination = targetPoints[i] + (scatter ? velocities[i] * spread : 0);
          pos[i] += (destination - pos[i]) * blend;
        }

        pg.attributes.position.needsUpdate = true;
      }

      return {
        resize(width, height) {
          const w = Math.max(1, Math.floor(width));
          const h = Math.max(1, Math.floor(height));
          renderer.setPixelRatio(pixelRatio());
          renderer.setSize(w, h, false);
          camera.aspect = w / h;
          camera.position.z = isMobile() ? 1.35 / Math.min(1, camera.aspect) : fittedDistance(camera,fitRadius);
          // Keep the camera fixed during the burst. Scale the spread to the visible
          // box instead of zooming out to contain the expanding particles.
          const halfHeight=camera.position.z*Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
          if(isMobile()){spreadX=spreadY=spreadZ=1;}
          else{
            const visibleRadius=halfHeight*Math.sqrt(Math.min(camera.aspect,2));
            spreadX=spreadY=visibleRadius*1.3/.9;
            // Increase the screen-space burst without pushing particles through the camera.
            spreadZ=visibleRadius*.95/.9*.45;
          }
          camera.updateProjectionMatrix();
        },
        tick(time) {
          if (disposed) return;
          update(time);
          renderer.render(scene, camera);
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          if (cellEl) {
            cellEl.removeEventListener('pointerenter', handlePointerEnter);
            cellEl.removeEventListener('pointerleave', handlePointerLeave);
            cellEl.removeEventListener('pointercancel', handlePointerLeave);
          }
          if (canvasEl.parentNode) {
            canvasEl.parentNode.removeChild(canvasEl);
          }
          disposeScene(scene);
          renderer.dispose(); renderer.forceContextLoss();
        }
      };

      // ---- ヘルパー：ジオメトリ表面から一様サンプリング（indexed/non-indexed両対応）----
      function samplePointsOnGeometrySurface(geometry, count) {
        const posAttr = geometry.getAttribute('position');
        const indexAttr = geometry.getIndex();

        const getTriangle = (triIndex, outA, outB, outC) => {
          if (indexAttr) {
            const i0 = indexAttr.getX(triIndex * 3);
            const i1 = indexAttr.getX(triIndex * 3 + 1);
            const i2 = indexAttr.getX(triIndex * 3 + 2);
            outA.fromBufferAttribute(posAttr, i0);
            outB.fromBufferAttribute(posAttr, i1);
            outC.fromBufferAttribute(posAttr, i2);
          } else {
            const i0 = triIndex * 3;
            const i1 = i0 + 1;
            const i2 = i0 + 2;
            outA.fromBufferAttribute(posAttr, i0);
            outB.fromBufferAttribute(posAttr, i1);
            outC.fromBufferAttribute(posAttr, i2);
          }
        };

        const triCount = indexAttr ? (indexAttr.count / 3) : (posAttr.count / 3);

        const areas = new Float32Array(triCount);
        let totalArea = 0;
        const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
        const ab = new THREE.Vector3(), ac = new THREE.Vector3();

        for (let i = 0; i < triCount; i++) {
          getTriangle(i, a, b, c);
          ab.copy(b).sub(a);
          ac.copy(c).sub(a);
          const area = ab.cross(ac).length() * 0.5;
          totalArea += area;
          areas[i] = totalArea;
        }
        if (totalArea === 0) {
          console.warn('samplePointsOnGeometrySurface: totalArea = 0（頂点/面の取得に失敗）');
          return new Float32Array(count * 3).fill(0);
        }

        const out = new Float32Array(count * 3);
        const p = new THREE.Vector3();
        const tmp = new THREE.Vector3();

        const pickTriangle = () => {
          const r = Math.random() * totalArea;
          let lo = 0, hi = triCount - 1;
          while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (r <= areas[mid]) hi = mid; else lo = mid + 1;
          }
          return lo;
        };

        for (let i = 0; i < count; i++) {
          const ti = pickTriangle();
          getTriangle(ti, a, b, c);

          let u = Math.random();
          let v = Math.random();
          if (u + v > 1) { u = 1 - u; v = 1 - v; }

          p.copy(a);
          tmp.copy(b).sub(a); p.addScaledVector(tmp, u);
          tmp.copy(c).sub(a); p.addScaledVector(tmp, v);

          out[i * 3] = p.x;
          out[i * 3 + 1] = p.y;
          out[i * 3 + 2] = p.z;
        }
        return out;
      }

    }


    const PIXELATE_VERTEX_SHADER = `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
    const PIXELATE_FRAGMENT_SHADER = `uniform sampler2D tDiffuse;uniform vec2 resolution;uniform vec2 pixelSize;varying vec2 vUv;void main(){vec2 texel=pixelSize / resolution;vec2 pixelatedUV=floor(vUv / texel)*texel;gl_FragColor=texture2D(tDiffuse,pixelatedUV);}`;

    function createPixelateShader({ resolutionUniform, pixelSizeUniform } = {}) {
      const resolution = resolutionUniform ?? new THREE.Vector2(1, 1);
      const pixelSize = pixelSizeUniform ?? new THREE.Vector2(2.0, 2.0);
      return {
        shader: {
          uniforms: {
            tDiffuse: { value: null },
            resolution: { value: resolution },
            pixelSize: { value: pixelSize }
          },
          vertexShader: PIXELATE_VERTEX_SHADER,
          fragmentShader: PIXELATE_FRAGMENT_SHADER
        },
        resolutionUniform: resolution,
        pixelSizeUniform: pixelSize
      };
    }

    function createScanLineOne(cellEl) {
      let fitRadius = 1;
      if (!cellEl) return null;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xdeefff);
      const bloomBackground = new THREE.Color(0x000000);

      const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
      camera.position.set(0, 0, 2.2);
      camera.lookAt(0, 0, 0);

      const ambientLight = new THREE.AmbientLight(0xffffff, 1);
      scene.add(ambientLight);

      const directionalLight = new THREE.DirectionalLight(0xdeefff, 0.8);
      directionalLight.position.set(10, 10, 10);
      scene.add(directionalLight);

      const group = new THREE.Group();
      group.rotation.set(NUMBER_BASE_ROT_X, NUMBER_BASE_ROT_Y, 0);
      scene.add(group);

      const BLOOM_LAYER = 1;
      const bloomLayer = new THREE.Layers();
      bloomLayer.set(BLOOM_LAYER);
      const darkMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
      darkMaterial.toneMapped = false;
      const storedMaterials = Object.create(null);

      const material = new THREE.MeshPhongMaterial({
        transparent: true,
        opacity: 0.7,
        color: 0x024b9e,
        emissive: 0x00152e,
        shininess: 100,
        specular: 0xdeefff
      });

      getHelvetikerRegular()
        .then((font) => {
          const geometry = new TextGeometry('1', {
            font,
            size: 1.4,
            depth: 0.42,
            curveSegments: 8,
            bevelEnabled: true,
            bevelThickness: 0.03,
            bevelSize: 0.02,
            bevelSegments: 2
          });
          geometry.center();
          geometry.computeBoundingSphere();fitRadius=geometry.boundingSphere.radius;
          if(!isMobile())camera.position.z=fittedDistance(camera,fitRadius);
          const mesh = new THREE.Mesh(geometry, material);
          mesh.layers.enable(BLOOM_LAYER);
          group.add(mesh);
        })
        .catch((err) => console.warn('Failed to load font for Scene 3', err));

      if (!cellEl.style.position) cellEl.style.position = 'relative';
      cellEl.style.userSelect = 'none';
      cellEl.style.touchAction = 'pan-y';
      cellEl.style.cursor = 'default';

      const renderer = new THREE.WebGLRenderer({ antialias: !isMobile(), alpha: true, powerPreference: 'default' });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.setClearColor(0xdeefff, 0);
      renderer.setPixelRatio(pixelRatio());
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      renderer.domElement.style.display = 'block';
      renderer.domElement.style.touchAction = 'pan-y';
      cellEl.appendChild(renderer.domElement);

      const pointerRot = { currentX: 0, currentY: 0 };
      const darkenNonBloomed = (obj) => {
        if (!obj.isMesh) return;
        if (bloomLayer.test(obj.layers)) return;
        if (storedMaterials[obj.uuid]) return;
        storedMaterials[obj.uuid] = obj.material;
        obj.material = darkMaterial;
      };
      const restoreMaterial = (obj) => {
        if (!obj.isMesh) return;
        const original = storedMaterials[obj.uuid];
        if (!original) return;
        obj.material = original;
        delete storedMaterials[obj.uuid];
      };
      let currentTime = 0;
      let composer = null;
      let bloomComposer = null;
      let renderPass = null;
      let bloomRenderPass = null;
      let bloomPass = null;
      let bloomCompositePass = null;
      let pixelatePass = null;
      let pixelateUniforms = null;
      let scanLinePass = null;
      let grainPass = null;
      let composerInitialized = false;
      const USE_POST = true;
      const ENABLE_SCANLINE = true;
      const resolutionUniform = new THREE.Vector2(1, 1);
      const BASE_PIXEL_SIZE = new THREE.Vector2(5.0, 5.0);
      const HOVER_PIXEL_SIZE = new THREE.Vector2(50.0, 50.0);
      const pixelSizeUniform = BASE_PIXEL_SIZE.clone();
      const pixelSizeTarget = BASE_PIXEL_SIZE.clone();
      const pixelSizeStart = BASE_PIXEL_SIZE.clone();
      const PIXEL_TRANSITION_DURATION = 1.0;
      let pixelTransitionStart = null;
      let pixelHoverActive = false;
      let width = 0;
      let height = 0;
      let disposed = false;

      const { shader: pixelateShader } = createPixelateShader({ resolutionUniform, pixelSizeUniform });
      const pointerWithinCell = () => globalPointer.active && globalPointer.cell === cellEl;

      const scanLineShader = {
        uniforms: {
          tDiffuse: { value: null },
          time: { value: 0.0 },
          resolution: { value: resolutionUniform },
          lineHeight: { value: 8.0 },
          lineSpacing: { value: 5.5 },
          opacity: { value: 0.6 }
        },
        vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
        fragmentShader: `uniform sampler2D tDiffuse;uniform float time;uniform float lineHeight;uniform float lineSpacing;uniform float opacity;varying vec2 vUv;void main(){vec4 color=texture2D(tDiffuse,vUv);float pos=gl_FragCoord.y+time*120.0;float mask=step(lineSpacing,mod(pos,lineHeight));vec3 highlight=mix(color.rgb,vec3(1.0),opacity);color.rgb=mix(color.rgb,highlight,mask);gl_FragColor=color;}`
      };

      const grainShader = {
        uniforms: {
          tDiffuse: { value: null },
          time: { value: 0.0 }
        },
        vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
        fragmentShader: `uniform sampler2D tDiffuse;uniform float time;varying vec2 vUv;float random(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233))+time)*43758.5453);}void main(){vec4 color=texture2D(tDiffuse,vUv);float grain=random(vUv);color.rgb+=(grain-0.5)*0.05;gl_FragColor=color;}`
      };

      const bloomCompositeShader = {
        uniforms: {
          tDiffuse: { value: null },
          bloomTexture: { value: null }
        },
        vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
        fragmentShader: `uniform sampler2D tDiffuse;uniform sampler2D bloomTexture;varying vec2 vUv;void main(){vec4 base=texture2D(tDiffuse,vUv);vec4 bloom=texture2D(bloomTexture,vUv);gl_FragColor=vec4(base.rgb + bloom.rgb, base.a);}`
      };

      let composerWidth = 0, composerHeight = 0;
      function ensureComposer(width, height) {
        if (composerInitialized && width === composerWidth && height === composerHeight) return;
        composerWidth = width; composerHeight = height;
        const safeWidth = Math.max(1, Math.floor(width || 1));
        const safeHeight = Math.max(1, Math.floor(height || 1));
        if (!composer) {
          composer = new EffectComposer(renderer);
          renderPass = new RenderPass(scene, camera);
          renderPass.clear = true;
          renderPass.clearDepth = true;
          composer.addPass(renderPass);

          bloomCompositePass = new ShaderPass(bloomCompositeShader);
          composer.addPass(bloomCompositePass);

          pixelatePass = new ShaderPass(pixelateShader);
          composer.addPass(pixelatePass);
          pixelateUniforms = pixelatePass.uniforms || pixelatePass.material?.uniforms || null;

          if (ENABLE_SCANLINE) {
            scanLinePass = new ShaderPass(scanLineShader);
            scanLinePass.material.blending = THREE.NormalBlending;
            composer.addPass(scanLinePass);
            scanLinePass.uniforms.time.value = currentTime * 60.0;
            scanLinePass.uniforms.resolution.value.set(safeWidth, safeHeight);
          }
          grainPass = new ShaderPass(grainShader);
          grainPass.renderToScreen = false;
          composer.addPass(grainPass);
          grainPass.uniforms.time.value = currentTime * 0.5;
        }

        if (!bloomComposer) {
          bloomComposer = new EffectComposer(renderer);
          bloomRenderPass = new RenderPass(scene, camera);
          bloomRenderPass.clear = true;
          bloomRenderPass.clearDepth = true;
          bloomComposer.addPass(bloomRenderPass);

          bloomPass = new UnrealBloomPass(new THREE.Vector2(safeWidth, safeHeight), 3.2, 0.8, 2.0);
          bloomPass.threshold = 0.2;
          bloomComposer.addPass(bloomPass);
        }

        if (renderPass) renderPass.camera = camera;
        if (bloomRenderPass) bloomRenderPass.camera = camera;
        composer.setSize(safeWidth, safeHeight);
        bloomComposer?.setSize(safeWidth, safeHeight);
        bloomPass?.setSize(safeWidth, safeHeight);
        resolutionUniform.set(safeWidth, safeHeight);
        pixelatePass?.uniforms?.resolution?.value?.set(safeWidth, safeHeight);
        if (ENABLE_SCANLINE && scanLinePass) {
          scanLinePass.uniforms.resolution.value.set(safeWidth, safeHeight);
        }
        if (bloomCompositePass && bloomComposer) {
          bloomCompositePass.uniforms.bloomTexture.value =
            (bloomComposer.renderTarget2 && bloomComposer.renderTarget2.texture) ||
            (bloomComposer.renderTarget1 && bloomComposer.renderTarget1.texture) ||
            null;
        }
        composerInitialized = !!(composer && bloomComposer && bloomCompositePass);
      }

      function updateState(t) {
        currentTime = t;
        const active = globalPointer.active;
        const targetY = active
          ? THREE.MathUtils.clamp(globalPointer.nx * NUMBER_ROT_MAX_Y, -NUMBER_ROT_MAX_Y, NUMBER_ROT_MAX_Y)
          : 0;
        const targetX = active
          ? THREE.MathUtils.clamp(-globalPointer.ny * NUMBER_ROT_MAX_X, -NUMBER_ROT_MAX_X, NUMBER_ROT_MAX_X)
          : 0;
        const ease = active ? 0.18 : 0.12;
        pointerRot.currentX += (targetX - pointerRot.currentX) * ease;
        pointerRot.currentY += (targetY - pointerRot.currentY) * ease;

        const baseY = NUMBER_BASE_ROT_Y + t * NUMBER_AUTO_ROT_SPEED;
        group.rotation.y = baseY + pointerRot.currentY;
        group.rotation.x = NUMBER_BASE_ROT_X + pointerRot.currentX;
        const hovered = pointerWithinCell();
        if (hovered !== pixelHoverActive) {
          pixelHoverActive = hovered;
          pixelSizeStart.copy(pixelSizeUniform);
          pixelSizeTarget.copy(hovered ? HOVER_PIXEL_SIZE : BASE_PIXEL_SIZE);
          pixelTransitionStart = t;
        }
        if (pixelTransitionStart !== null) {
          const progress = Math.min(1, Math.max(0, (t - pixelTransitionStart) / PIXEL_TRANSITION_DURATION));
          const eased = progress * progress * (3 - 2 * progress);
          pixelSizeUniform.lerpVectors(pixelSizeStart, pixelSizeTarget, eased);
          if (progress === 1) pixelTransitionStart = null;
        }

        if (ENABLE_SCANLINE && composerInitialized && scanLinePass) {
          scanLinePass.uniforms.time.value = currentTime * 60.0;
        }
        if (composerInitialized && grainPass) {
          grainPass.uniforms.time.value = currentTime * 0.5;
        }
        if (pixelateUniforms?.pixelSize?.value) {
          pixelateUniforms.pixelSize.value.copy(pixelSizeUniform);
        }
      }

      function renderFrame() {
        if (!width || !height) return;
        if (!USE_POST) {
          renderer.render(scene, camera);
          return;
        }
        ensureComposer(width, height);
        if (!composerInitialized) return;
        const prevAutoClear = renderer.autoClear;
        renderer.autoClear = true;
        const previousBackground = scene.background;
        scene.background = bloomBackground;
        scene.traverse(darkenNonBloomed);
        bloomComposer?.render();
        scene.traverse(restoreMaterial);
        scene.background = previousBackground;
        if (bloomCompositePass && bloomComposer) {
          const bloomTexture =
            (bloomComposer.renderTarget2 && bloomComposer.renderTarget2.texture) ||
            (bloomComposer.renderTarget1 && bloomComposer.renderTarget1.texture) ||
            null;
          bloomCompositePass.uniforms.bloomTexture.value = bloomTexture;
        }
        composer.render();
        renderer.autoClear = prevAutoClear;
      }

      return {
        resize(newWidth, newHeight) {
          width = Math.max(1, Math.floor(newWidth));
          height = Math.max(1, Math.floor(newHeight));
          renderer.setPixelRatio(pixelRatio());
          renderer.setSize(width, height, false);
          camera.aspect = width / height;
          camera.position.z = isMobile() ? 1.3 / Math.min(1, camera.aspect) : fittedDistance(camera,fitRadius);
          camera.updateProjectionMatrix();
          ensureComposer(width, height);
        },
        tick(time) {
          if (disposed) return;
          updateState(time);
          renderFrame();
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          composer?.passes?.forEach((pass) => pass.dispose?.());
          composer?.dispose?.();
          bloomComposer?.passes?.forEach((pass) => pass.dispose?.());
          bloomComposer?.dispose?.();
          darkMaterial.dispose?.();
          composer = null;
          bloomComposer = null;
          renderPass = null;
          bloomRenderPass = null;
          bloomPass = null;
          bloomCompositePass = null;
          pixelatePass = null;
          pixelateUniforms = null;
          pixelSizeUniform.copy(BASE_PIXEL_SIZE);
          pixelSizeTarget.copy(BASE_PIXEL_SIZE);
          scanLinePass = null;
          grainPass = null;
          composerInitialized = false;
          if (renderer.domElement.parentNode) {
            renderer.domElement.parentNode.removeChild(renderer.domElement);
          }
          disposeScene(scene);
          renderer.dispose(); renderer.forceContextLoss();
        }
      };
    }


export const createHeroEffects = [createNumber3, createNumber2, createScanLineOne];

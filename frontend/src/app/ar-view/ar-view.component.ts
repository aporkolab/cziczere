import {
  Component,
  OnInit,
  ElementRef,
  ViewChild,
  OnDestroy,
  inject,
  Output,
  EventEmitter,
} from "@angular/core";

import * as THREE from "three";
import { ARButton } from "three/examples/jsm/webxr/ARButton.js";
import { MemoryData } from "../api.service";
import { ArStateService } from "../ar-state.service";
import { Subscription } from "rxjs";

@Component({
  selector: "app-ar-view",
  standalone: true,
  imports: [],
  templateUrl: "./ar-view.component.html",
  styleUrls: ["./ar-view.component.css"],
})
export class ArViewComponent implements OnInit, OnDestroy {
  @ViewChild("arContainer", { static: true }) arContainer!: ElementRef;

  private arStateService: ArStateService = inject(ArStateService);
  private memorySubscription!: Subscription;
  private currentMemory: MemoryData | null = null;
  private textureLoader = new THREE.TextureLoader();

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private controller!: THREE.XRTargetRaySpace;
  private reticle!: THREE.Mesh;
  private hitTestSource?: XRHitTestSource;
  private hitTestSourceRequested = false;
  private placedObjects: { mesh: THREE.Mesh; memory: MemoryData }[] = [];
  private raycaster = new THREE.Raycaster();

  @Output() memorySelected = new EventEmitter<MemoryData>();

  ngOnInit(): void {
    this.initXR();
    this.memorySubscription = this.arStateService.selectedMemory$.subscribe(
      (memory) => {
        this.currentMemory = memory;
      },
    );
  }

  ngOnDestroy(): void {
    if (this.memorySubscription) {
      this.memorySubscription.unsubscribe();
    }
    // Clean up Three.js resources
    if (this.renderer) {
      const session = this.renderer.xr.getSession();
      session?.end();
      this.renderer.dispose();
    }
  }

  private initXR(): void {
    const container = this.arContainer.nativeElement;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.01,
      20,
    );

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.xr.enabled = true;
    container.appendChild(this.renderer.domElement);

    const arButton = ARButton.createButton(this.renderer, {
      requiredFeatures: ["hit-test"],
    });
    container.appendChild(arButton);

    this.setupContent();

    this.renderer.setAnimationLoop((timestamp, frame) => {
      if (frame) {
        this.updateHitTest(frame);
      }
      // Make all placed objects face the camera
      this.placedObjects.forEach((object) => {
        object.mesh.quaternion.copy(this.camera.quaternion);
      });

      this.renderer.render(this.scene, this.camera);
    });
  }

  private setupContent(): void {
    const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
    light.position.set(0.5, 1, 0.25);
    this.scene.add(light);

    this.reticle = new THREE.Mesh(
      new THREE.RingGeometry(0.05, 0.07, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial(),
    );
    this.reticle.matrixAutoUpdate = false;
    this.reticle.visible = false;
    this.scene.add(this.reticle);

    this.controller = this.renderer.xr.getController(0);
    this.controller.addEventListener("select", this.onSelect.bind(this));
    this.scene.add(this.controller);
  }

  private onSelect(): void {
    // First, try to interact with existing objects
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const intersects = this.raycaster.intersectObjects(
      this.placedObjects.map((p) => p.mesh),
    );

    if (intersects.length > 0) {
      const firstIntersected = this.placedObjects.find(
        (p) => p.mesh === intersects[0].object,
      );
      if (firstIntersected) {
        this.memorySelected.emit(firstIntersected.memory);
        return; // Stop after finding the first object
      }
    }

    // If no object was hit, try to place a new one
    if (this.reticle.visible && this.currentMemory) {
      const memory = this.currentMemory;

      const createMemoryPlane = (texture: THREE.Texture) => {
        const material = new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
        });
        const geometry = new THREE.PlaneGeometry(0.2, 0.2); // Adjust size as needed
        const plane = new THREE.Mesh(geometry, material);
        plane.position.setFromMatrixPosition(this.reticle.matrix);
        this.scene.add(plane);
        this.placedObjects.push({ mesh: plane, memory: memory }); // Add to our list of objects
      };

      if (memory.imageUrl) {
        this.textureLoader.load(memory.imageUrl, createMemoryPlane);
      } else {
        const canvas = this.createTextCanvas(memory.userText);
        const texture = new THREE.CanvasTexture(canvas);
        createMemoryPlane(texture);
      }
    }
  }

  private createTextCanvas(text: string): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d")!;
    const canvasWidth = 256;
    const canvasHeight = 256;
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    // Background
    context.fillStyle = "rgba(255, 255, 255, 0.8)";
    context.fillRect(0, 0, canvasWidth, canvasHeight);

    // Text properties
    context.fillStyle = "black";
    context.font = "16px Arial";
    context.textAlign = "center";
    context.textBaseline = "middle";

    // Wrap text
    const words = text.split(" ");
    let line = "";
    let y = canvasHeight / 2 - (words.length / 4) * 10; // Start position adjustment

    for (let n = 0; n < words.length; n++) {
      const testLine = line + words[n] + " ";
      const metrics = context.measureText(testLine);
      const testWidth = metrics.width;
      if (testWidth > canvasWidth - 20 && n > 0) {
        context.fillText(line, canvasWidth / 2, y);
        line = words[n] + " ";
        y += 20; // Line height
      } else {
        line = testLine;
      }
    }
    context.fillText(line, canvasWidth / 2, y);

    return canvas;
  }

  private async updateHitTest(frame: XRFrame): Promise<void> {
    const session = this.renderer.xr.getSession();
    if (!session) return;

    if (!this.hitTestSourceRequested) {
      const referenceSpace = await session.requestReferenceSpace("viewer");
      this.hitTestSource = await session.requestHitTestSource?.({
        space: referenceSpace,
      });
      this.hitTestSourceRequested = true;
    }

    if (this.hitTestSource) {
      const hitTestResults = frame.getHitTestResults(this.hitTestSource);
      if (hitTestResults.length > 0) {
        const hit = hitTestResults[0];
        const referenceSpace = this.renderer.xr.getReferenceSpace();
        if (referenceSpace) {
          const pose = hit.getPose(referenceSpace);
          if (pose) {
            this.reticle.visible = true;
            this.reticle.matrix.fromArray(pose.transform.matrix);
          }
        }
      } else {
        this.reticle.visible = false;
      }
    }
  }
}

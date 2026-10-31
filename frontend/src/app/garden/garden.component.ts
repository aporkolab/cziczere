import {
  Component,
  AfterViewInit,
  ViewChild,
  ElementRef,
  OnDestroy,
  Output,
  EventEmitter,
  inject,
} from "@angular/core";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { ApiService, AtmosphereData, MemoryData } from "../api.service";

import { Subscription } from "rxjs";

@Component({
  selector: "app-garden",
  templateUrl: "./garden.component.html",
  styleUrls: ["./garden.component.css"],
  standalone: true,
  imports: [],
})
export class GardenComponent implements AfterViewInit, OnDestroy {
  @ViewChild("canvas") private canvasRef!: ElementRef;
  @Output() memoryClicked = new EventEmitter<MemoryData>();

  private memories: MemoryData[] = [];
  private memorySubscription!: Subscription;
  private atmosphereSubscription!: Subscription;

  private camera!: THREE.PerspectiveCamera;
  private scene!: THREE.Scene;
  private renderer!: THREE.WebGLRenderer;
  private controls!: OrbitControls;
  private atmosphere: AtmosphereData | null = null;
  private memoryMeshes: THREE.Mesh[] = [];
  private weatherParticles: THREE.Points | null = null;
  private audioPlayer = new Audio();
  private emptyGardenCenter: THREE.Mesh | null = null;

  private readonly apiService = inject(ApiService);

  ngAfterViewInit(): void {
    this.createScene();
    this.createControls();
    this.startRenderingLoop();
    this.getAtmosphere();
    this.getMemories();
  }

  ngOnDestroy(): void {
    if (this.memorySubscription) {
      this.memorySubscription.unsubscribe();
    }
    if (this.atmosphereSubscription) {
      this.atmosphereSubscription.unsubscribe();
    }
    this.audioPlayer.pause();
    // Also dispose of Three.js objects to prevent memory leaks
    this.renderer.dispose();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
        object.geometry.dispose();
        const material = object.material;
        if (Array.isArray(material)) {
          material.forEach((mat) => mat.dispose());
        } else {
          material.dispose();
        }
      }
    });
  }

  private createScene(): void {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.getTimeBasedColor()); // Time-based default color
    this.camera = new THREE.PerspectiveCamera(
      75,
      this.getAspectRatio(),
      0.1,
      1000,
    );
    this.camera.position.z = 10;
  }

  private getAtmosphere(): void {
    this.atmosphereSubscription = this.apiService.getAtmosphere().subscribe({
      next: (data: AtmosphereData) => {
        this.atmosphere = data;
        if (this.scene) {
          this.scene.background = new THREE.Color(data.backgroundColor);
          this.createWeatherParticles(data.weather);
        }
        this.audioPlayer.src = `assets/${data.soundUrl}`;
        this.audioPlayer.loop = true;
        this.audioPlayer
          .play()
          .catch((e) => console.error("Error playing audio:", e));
        console.log("Atmosphere data:", data);
      },
      error: (error) => {
        console.error("Error getting atmosphere:", error);
        // Fallback to time-based atmosphere instead of fixed color
        this.scene.background = new THREE.Color(this.getTimeBasedColor());
      },
    });
  }

  private getMemories(): void {
    this.memorySubscription = this.apiService.getMemories().subscribe({
      next: (memories: MemoryData[]) => {
        this.memories = memories;
        this.recreateMemoryVisuals();
      },
      error: (error) => {
        console.error("Error getting memories:", error);
        // Keep existing memories if any, or show empty garden
        this.memories = this.memories || [];
      },
    });
  }

  private createWeatherParticles(weather: string): void {
    if (this.weatherParticles) {
      this.scene.remove(this.weatherParticles);
      this.weatherParticles.geometry.dispose();
      (this.weatherParticles.material as THREE.Material).dispose();
      this.weatherParticles = null;
    }

    if (weather !== "Rainy" && weather !== "Snowy") {
      return;
    }

    const particleCount = 5000;
    const vertices = [];
    for (let i = 0; i < particleCount; i++) {
      const x = Math.random() * 200 - 100;
      const y = Math.random() * 100 - 50;
      const z = Math.random() * 100 - 50;
      vertices.push(x, y, z);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(vertices, 3),
    );

    const material = new THREE.PointsMaterial({
      color: 0xffffff,
      size: weather === "Snowy" ? 0.2 : 0.1,
      transparent: true,
      opacity: 0.7,
    });

    this.weatherParticles = new THREE.Points(geometry, material);
    this.scene.add(this.weatherParticles);
  }

  private recreateMemoryVisuals(): void {
    // Clear existing meshes from the scene
    this.memoryMeshes.forEach((mesh) => this.scene.remove(mesh));
    this.memoryMeshes = []; // Clear the array

    // If no memories exist, show the central stone/sapling
    if (this.memories.length === 0) {
      this.createEmptyGardenCenter();
      return;
    }

    // Remove empty garden center if memories exist
    this.removeEmptyGardenCenter();

    const textureLoader = new THREE.TextureLoader();
    const geometry = new THREE.PlaneGeometry(1, 1);

    this.memories.forEach((memory, index) => {
      const texture = textureLoader.load(memory.imageUrl);
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
      });
      const plane = new THREE.Mesh(geometry, material);

      // Associate memory data with the mesh for hit-testing
      plane.userData = { memory };

      // Simple spiral layout (Phyllotaxis)
      const c = 2; // Scaling factor
      const angle = index * 137.5; // Golden angle
      const radius = c * Math.sqrt(index);
      const x = radius * Math.cos((angle * Math.PI) / 180);
      const y = radius * Math.sin((angle * Math.PI) / 180);

      plane.position.set(x, y, 0);

      this.scene.add(plane);
      this.memoryMeshes.push(plane);
    });
  }

  private createControls(): void {
    const canvas = this.canvasRef.nativeElement;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
  }

  private animateWeather(): void {
    if (this.weatherParticles) {
      const positions = this.weatherParticles.geometry.attributes["position"]
        .array as Float32Array;
      const speed = this.atmosphere?.weather === "Snowy" ? -0.05 : -0.2;

      for (let i = 1; i < positions.length; i += 3) {
        positions[i] += speed; // Move down
        if (positions[i] < -50) {
          positions[i] = 50; // Reset to top
        }
      }
      this.weatherParticles.geometry.attributes["position"].needsUpdate = true;
    }
  }

  private startRenderingLoop(): void {
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.animateWeather();
      this.renderer.render(this.scene, this.camera);
    });
  }

  private getAspectRatio(): number {
    return (
      this.canvasRef.nativeElement.clientWidth /
      this.canvasRef.nativeElement.clientHeight
    );
  }

  onCanvasClick(event: MouseEvent): void {
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    const mouse = new THREE.Vector2(x, y);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.camera);

    const intersects = raycaster.intersectObjects(this.memoryMeshes);

    if (intersects.length > 0) {
      const clickedObject = intersects[0].object as THREE.Mesh;
      const memory = clickedObject.userData["memory"] as MemoryData;
      if (memory) {
        this.memoryClicked.emit(memory);
      }
    }
  }

  private getTimeBasedColor(): number {
    const now = new Date();
    const hour = now.getHours();

    // Early morning (5-8): Soft pink/orange
    if (hour >= 5 && hour < 8) {
      return 0xffd7ba; // Soft peachy dawn
    }
    // Morning (8-12): Bright blue
    else if (hour >= 8 && hour < 12) {
      return 0x87ceeb; // Sky blue
    }
    // Afternoon (12-17): Clear blue
    else if (hour >= 12 && hour < 17) {
      return 0xabcdef; // Light blue
    }
    // Evening (17-20): Golden hour
    else if (hour >= 17 && hour < 20) {
      return 0xffa500; // Golden orange
    }
    // Night (20-23): Deep blue
    else if (hour >= 20 && hour < 23) {
      return 0x191970; // Midnight blue
    }
    // Late night (23-5): Dark purple
    else {
      return 0x2f1b69; // Dark purple
    }
  }

  private createEmptyGardenCenter(): void {
    if (this.emptyGardenCenter) return; // Already exists

    // Create a simple geometric shape representing a "central stone" or "sapling"
    const geometry = new THREE.ConeGeometry(0.3, 1, 8);
    const material = new THREE.MeshBasicMaterial({
      color: 0x8b7355, // Brown color for a natural look
      transparent: true,
      opacity: 0.7,
    });

    this.emptyGardenCenter = new THREE.Mesh(geometry, material);
    this.emptyGardenCenter.position.set(0, -0.3, 0); // Slightly below center
    this.emptyGardenCenter.userData = { isEmptyCenter: true };

    this.scene.add(this.emptyGardenCenter);
  }

  private removeEmptyGardenCenter(): void {
    if (this.emptyGardenCenter) {
      this.scene.remove(this.emptyGardenCenter);
      this.emptyGardenCenter.geometry.dispose();
      (this.emptyGardenCenter.material as THREE.Material).dispose();
      this.emptyGardenCenter = null;
    }
  }

  public exportAsPoster(): void {
    const posterWidth = 4096;
    const posterHeight = 4096;

    const posterRenderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
    });
    posterRenderer.setSize(posterWidth, posterHeight);

    posterRenderer.domElement.style.position = "absolute";
    posterRenderer.domElement.style.left = "-9999px";
    document.body.appendChild(posterRenderer.domElement);

    const boundingBox = new THREE.Box3().setFromObject(this.scene!);
    const center = boundingBox.getCenter(new THREE.Vector3());
    const size = boundingBox.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = this.camera!.fov * (Math.PI / 180);
    let cameraZ = Math.abs((maxDim / 2) * Math.tan(fov * 2));
    cameraZ *= 1.1;

    const posterCamera = new THREE.PerspectiveCamera(
      this.camera!.fov,
      posterWidth / posterHeight,
      0.1,
      1000,
    );
    posterCamera.position.set(center.x, center.y, center.z + cameraZ);
    posterCamera.lookAt(center);

    posterRenderer.render(this.scene!, posterCamera);

    const link = document.createElement("a");
    link.download = "kert-poszter.png";
    link.href = posterRenderer.domElement.toDataURL("image/png");
    link.click();

    document.body.removeChild(posterRenderer.domElement);
  }
}

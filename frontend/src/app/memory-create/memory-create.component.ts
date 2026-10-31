import { Component, EventEmitter, Output, Input, inject } from "@angular/core";

import {
  FormControl,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from "@angular/forms";
import { ApiService, PoeticRephrasingResponse } from "../api.service";

@Component({
  selector: "app-memory-create",
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: "./memory-create.component.html",
  styleUrls: ["./memory-create.component.css"],
})
export class MemoryCreateComponent {
  @Output() memorySubmit = new EventEmitter<string>();
  @Input() isLoading: boolean = false;
  @Input() error: string | null = null;

  private apiService: ApiService = inject(ApiService);

  showCreativeAssistant = false;
  assistantSuggestion = "";
  assistantLoading = false;
  poeticRephrasing: PoeticRephrasingResponse | null = null;
  showPoeticOption = false;

  memoryForm = new FormGroup({
    text: new FormControl("", [Validators.required, Validators.minLength(10)]),
  });

  onSubmit() {
    if (this.memoryForm.valid && this.memoryForm.value.text) {
      this.memorySubmit.emit(this.memoryForm.value.text);
      this.memoryForm.reset();
      this.hideCreativeAssistant();
    }
  }

  toggleCreativeAssistant() {
    this.showCreativeAssistant = !this.showCreativeAssistant;
    if (this.showCreativeAssistant && !this.assistantSuggestion) {
      this.generateSuggestion();
    }
  }

  hideCreativeAssistant() {
    this.showCreativeAssistant = false;
    this.assistantSuggestion = "";
  }

  generateSuggestion() {
    this.assistantLoading = true;
    // Simple creative prompts based on common memory themes
    const prompts = [
      "Think of a moment when you felt completely at peace...",
      "Recall a time when you laughed until your stomach hurt...",
      "Remember a beautiful sunrise, sunset, or starry night...",
      "Consider a moment of unexpected kindness you experienced...",
      "Think about the smell, taste, or sound that brings you joy...",
      "Recall a conversation that changed your perspective...",
      "Remember a place where you felt truly safe and happy...",
      "Think of a moment when you felt proud of yourself...",
    ];

    // Simulate API call delay
    setTimeout(() => {
      this.assistantSuggestion =
        prompts[Math.floor(Math.random() * prompts.length)];
      this.assistantLoading = false;
    }, 800);
  }

  useAssistantSuggestion() {
    if (this.assistantSuggestion) {
      this.memoryForm.patchValue({ text: this.assistantSuggestion });
      this.hideCreativeAssistant();
    }
  }

  generatePoeticVersion() {
    const currentText = this.memoryForm.get("text")?.value;
    if (!currentText || currentText.trim().length < 10) {
      return; // Don't proceed if text is too short
    }

    this.assistantLoading = true;
    this.poeticRephrasing = null;

    this.apiService.getPoeticRephrasing(currentText.trim()).subscribe({
      next: (response) => {
        this.poeticRephrasing = response;
        this.showPoeticOption = true;
        this.assistantLoading = false;
      },
      error: (error) => {
        console.error("Error generating poetic rephrasing:", error);
        this.assistantLoading = false;
        // Fallback to simple enhancement
        this.poeticRephrasing = {
          poeticVersion: this.enhanceTextLocally(currentText),
          suggestion:
            "I created a local enhancement as the AI service wasn't available.",
        };
        this.showPoeticOption = true;
      },
    });
  }

  private enhanceTextLocally(text: string): string {
    // Simple local text enhancement as fallback
    return text
      .replace(/I /g, "I gently ")
      .replace(/was /g, "found myself ")
      .replace(/walked/g, "wandered")
      .replace(/saw/g, "witnessed")
      .replace(/felt/g, "experienced");
  }

  usePoeticVersion() {
    if (this.poeticRephrasing?.poeticVersion) {
      this.memoryForm.patchValue({ text: this.poeticRephrasing.poeticVersion });
      this.hidePoeticOption();
    }
  }

  hidePoeticOption() {
    this.showPoeticOption = false;
    this.poeticRephrasing = null;
  }
}

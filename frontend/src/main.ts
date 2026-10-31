import { provideZoneChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { bootstrapApplication } from '@angular/platform-browser';
import { initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { getAuth, provideAuth } from '@angular/fire/auth';
import { getFirestore, provideFirestore } from '@angular/fire/firestore';
import { getFunctions, provideFunctions } from '@angular/fire/functions';
import type { FirebaseOptions } from 'firebase/app';
import { AppComponent } from './app/app.component';
import { environment } from './environments/environment';

async function firebaseOptions(): Promise<FirebaseOptions> {
  if (!('firebaseConfigUrl' in environment) || typeof environment.firebaseConfigUrl !== 'string') {
    return environment.firebase;
  }

  const response = await fetch(environment.firebaseConfigUrl, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('Cannot read firebase-config.json. Run the local setup again.');
  }
  const config = await response.json();
  if (!config?.apiKey || !config.authDomain || !config.projectId || !config.appId) {
    throw new Error('firebase-config.json must contain your Firebase web app configuration.');
  }
  return config;
}

async function start() {
  const options = await firebaseOptions();
  await bootstrapApplication(AppComponent, {
    providers: [
      provideZoneChangeDetection(),
      provideHttpClient(),
      provideFirebaseApp(() => initializeApp(options)),
      provideAuth(() => getAuth()),
      provideFirestore(() => getFirestore()),
      provideFunctions(() => getFunctions())
    ]
  });
}

start().catch(error => {
  console.error(error);
  const root = document.querySelector('app-root');
  if (root) root.textContent = 'Cziczere could not start. ' + error.message;
});

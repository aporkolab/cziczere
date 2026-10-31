
# 🌱 Cziczere: The AI-Powered Digital Memory Garden

Cziczere is a generative art and digital well-being application that transforms user memories into a unique, ever-evolving digital garden. Using advanced AI, each memory is planted as a "seed," which blossoms into a procedurally generated visual element, creating a beautiful and personal sanctuary of positive moments.

This project is not a journal; it's an interactive art piece powered by your own reflections.

## Core Concept & Vision

In a fast-paced digital world, Cziczere offers a space for quiet reflection. The core philosophy is to leverage technology not for productivity, but for mindfulness. By focusing on positive memories and gratitude, users cultivate a personal garden that serves as a visual representation of their joy and peace. The application uses a serverless architecture on Google Cloud to provide a scalable, cost-effective, and intelligent experience.

## ✨ Key Features

-   **AI-Enhanced Memory Input**: A Large Language Model (LLM) analyzes user's memories to identify key themes, sentiments, and generate a creative prompt for image generation.
    
-   **Generative Visuals**: Each memory is rendered by Google's image generation model into a unique visual element, which is then stored in Google Cloud Storage.
    
-   **Secure Authentication**: User authentication is handled by Firebase Authentication, ensuring that each user's garden is private and secure.

-   **Dynamic Garden Atmosphere**: The garden's ambient environment (background color and weather effects like rain/snow) now changes based on the overall mood of recent memories.
    
-   **Interactive Exploration**: Users can navigate their 3D garden, and click on memories to see the associated text. The garden layout is a beautiful and organic spiral.
    
-   **The Gardener's Assistant**: An AI-powered conversational agent that helps users find patterns in their thoughts and offers gentle prompts for reflection. This includes a "Weekly Summary" feature that provides a poetic overview of the user's recent memories.
-   **AR/VR Mode**: Place your memories in your own room and view them in augmented reality.
-   **Comprehensive Backend Unit Tests**: The backend functions are now covered by a suite of unit tests using JUnit and Mockito to ensure reliability and correctness.

## 🛠️ Tech Stack & Architecture

This project is built on a fully serverless, cost-optimized architecture using the Google Cloud & Firebase ecosystem.


| Tier              | Technology / Service                                                                                     | Purpose                                                                                           |
|-------------------|----------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| **Frontend**      | [Angular](https://angular.io/)                                                                           | Modern, component-based framework for the user interface.                                         |
|                   | [Three.js](https://threejs.org/) / [p5.js](https://p5js.org/)                                            | WebGL library for rendering the 2D/3D garden canvas.                                              |
| **Hosting**       | [Firebase Hosting](https://firebase.google.com/docs/hosting)                                             | Global CDN for fast delivery of the frontend application.                                          |
| **Backend Logic** | [Cloud Functions for Firebase](https://firebase.google.com/docs/functions) (Java)                        | A Java-based serverless function that orchestrates AI calls and database interactions.            |
| **Database**      | [Cloud Firestore](https://firebase.google.com/docs/firestore)                                            | Real-time NoSQL database for storing memories, prompts, emotions, and image URLs.                 |
| **Authentication**| [Firebase Authentication](https://firebase.google.com/docs/auth)                                         | Secure, managed user authentication via Firebase ID tokens.                                       |
| **Image Storage** | [Google Cloud Storage](https://cloud.google.com/storage)                                                 | Stores the generated images and provides public URLs for access.                                  |
| **AI Services**   | [Google Vertex AI](https://cloud.google.com/vertex-ai)                                                   | Gemini models for text analysis and image generation. |

## Run Cziczere on your computer

Download and extract the [source ZIP](https://github.com/aporkolab/cziczere/archive/refs/heads/main.zip), or clone the repo. Install Python 3.8+ and start Docker Desktop or Docker Engine with Compose 2.17 or newer. Docker builds the Angular UI and the Java API. Your own Firebase and Google Cloud project handles sign-in, data storage and AI requests, which can incur charges.

In the extracted folder, double-click **Start-Cziczere.cmd** on Windows or **Start-Cziczere.command** on macOS. The launcher opens your browser when the services are ready. You can also start Cziczere from a terminal.

| macOS or Linux | Windows |
| --- | --- |
| `python3 start.py` | `py -3 start.py` |

On first launch, enter your **Firebase project ID**. The launcher looks up the public web configuration through Firebase Hosting. If it is unavailable, copy the five requested values from **Project settings → General → Your apps** into the terminal. You can also supply a web SDK JSON file. The launcher finds existing Google application credentials through `GOOGLE_APPLICATION_CREDENTIALS` or the standard gcloud ADC location. Otherwise it asks for the file path.

Once the containers are ready, open [http://localhost:4200](http://localhost:4200), sign in with Google and select **Plant a Memory**. The first build downloads dependencies and can take several minutes. Scheduled reminders and push notifications are outside this local setup.

### Prepare a new cloud project once

1. Create a **dedicated** Firebase project, link a billing account and register a web app under **Project settings → General**. In **Authentication**, enable the Google sign-in provider and add `localhost` under **Settings → Authorized domains**. [Firebase sign-in setup](https://firebase.google.com/docs/auth/web/google-signin)
2. Create the **(default)** Firestore database in Native mode. Publish the included `firestore.rules` and create the three collection indexes in `firestore.indexes.json`. With the Firebase CLI, run `firebase deploy --only firestore --project YOUR_PROJECT_ID` from the repo root. This publishes rules and indexes to the named project. Wait for the indexes to finish building. [Firestore index setup](https://firebase.google.com/docs/firestore/query-data/indexing)
3. Enable the **Vertex AI** and **Cloud Text-to-Speech** APIs. In Firebase **Storage**, create the default bucket and keep its access restricted. The local app uploads new images and audio to this bucket and issues a download link for each object (`FIREBASE_MEDIA_LINKS=true` in Compose). Anyone with a link can read that file. If you choose separate buckets, connect them to Firebase Storage in the same project. [Cloud Storage for Firebase setup](https://firebase.google.com/docs/storage/web/start)
4. Give the backend identity access to Vertex AI, Firestore reads/writes, the media buckets' objects and the project's enabled APIs. For example, use Vertex AI User, Cloud Datastore User and Service Usage Consumer on the project and Storage Object User on the media buckets. Use a local Google application-default credentials (ADC) file or a service-account JSON file that Docker can read. For user ADC, run `gcloud auth application-default login` and `gcloud auth application-default set-quota-project YOUR_PROJECT_ID`. [Google Cloud local credentials](https://cloud.google.com/docs/authentication/set-up-adc-local-dev-environment)

To get the web SDK JSON without Firebase Hosting, export it with the Firebase CLI (replace the web app ID and project ID with your own).

```sh
firebase apps:sdkconfig WEB YOUR_WEB_APP_ID --project YOUR_PROJECT_ID --json > firebase-web.json
```

Alternatively, save the six public SDK settings from **Project settings → General → Your apps** as a UTF-8 JSON object containing these string fields — `projectId`, `apiKey`, `authDomain`, `appId`, `messagingSenderId` and `storageBucket`.

### Restart, update or change settings

Run the same launcher again to restart. To update a clone, run `git pull` first, then run the launcher to rebuild. From the project directory, `docker compose logs -f` shows both services and `docker compose down` stops them. Your garden stays in your cloud project.

To change projects or credentials, pass the new values explicitly. Either option can be used on its own.

```sh
python3 start.py --firebase ./firebase-web.json --credentials "/path/to/google-credentials.json"
```

`--firebase` also accepts a project ID. The launcher saves the public Firebase settings and credential file path under `.cziczere/`. The backend reads the original credential file from a read-only mount.

Set environment variables before launching to override `CZ_PORT` (default `4200`), `GCS_BUCKET_NAME` for images or `INSIGHT_AUDIO_BUCKET` for audio. The local defaults for `GCP_REGION`, `GEMINI_MODEL` and `IMAGEN_MODEL` are `global`, `gemini-3.1-flash-lite` and `gemini-3.1-flash-image`, respectively. Choose a location supported by both selected models. [Google model availability](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/model-versions)

For hosted deployments, see the [production deployment notes](PRODUCTION_DEPLOYMENT.md).

## 🤝 Contributing

Contributions are welcome! If you have ideas for new features or improvements, please follow these steps:

- Fork the Project
- Create your Feature Branch (git checkout -b feature/AmazingFeature)
- Commit your Changes (git commit -m 'Add some AmazingFeature')
- Push to the Branch (git push origin feature/AmazingFeature)
- Open a Pull Request

## 🚀 Future Work

-   **True AI-Generated Ambient Music**: The current implementation uses placeholder sounds. A future enhancement would be to integrate a true text-to-music AI to generate unique soundscapes for each mood.
-   **Therapeutic Tool**: With the involvement of psychologists, the application could be further developed into a scientifically supported mental health tool.

## 📄 License

This project is distributed under the MIT License. See LICENSE.txt for more information.

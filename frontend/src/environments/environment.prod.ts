export const environment = {
  production: true,
  firebase: {
    apiKey: "${FIREBASE_API_KEY}",
    authDomain: "${FIREBASE_AUTH_DOMAIN}", 
    projectId: "${FIREBASE_PROJECT_ID}",
    storageBucket: "${FIREBASE_STORAGE_BUCKET}",
    messagingSenderId: "${FIREBASE_MESSAGING_SENDER_ID}",
    appId: "${FIREBASE_APP_ID}",
    measurementId: "${FIREBASE_MEASUREMENT_ID}"
  },
  apis: {
    // Placeholder URLs: the deploy workflow regenerates this file with the real project ID.
    generateMemoryPlant: 'https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/generateMemoryPlant',
    analyzeMemories: 'https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/analyzeMemories',
    getAtmosphere: 'https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/getAtmosphere',
    exportGarden: 'https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/exportGarden',
    getInsightAudio: 'https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/getInsightAudio',
    poeticRephrasing: 'https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/poeticRephrasing',
    chatWebSocket: 'wss://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/chatWebSocket'
  },
  features: {
    enableAnalytics: true,
    enablePerformanceMonitoring: true,
    enableCrashlytics: true,
    enableNotifications: true,
    maxMemoriesPerUser: 1000,
    maxConversationHistory: 100,
    enableAdvancedAR: true,
    enableProfanityFilter: true,
    enableRateLimiting: true
  },
  monitoring: {
    sentryDsn: "${SENTRY_DSN}",
    logLevel: "warn",
    enableUserTracking: true,
    enableErrorReporting: true
  },
  performance: {
    enableServiceWorker: true,
    enableLazyLoading: true,
    enableImageOptimization: true,
    enableBundleAnalysis: false
  }
};

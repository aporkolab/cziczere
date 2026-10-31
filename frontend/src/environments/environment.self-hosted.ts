import { environment as production } from './environment.prod';

export const environment = {
  ...production,
  firebaseConfigUrl: '/firebase-config.json',
  features: { ...production.features, enableNotifications: false },
  apis: {
    ...production.apis,
    generateMemoryPlant: '/api/generateMemoryPlant',
    analyzeMemories: '/api/analyzeMemories',
    getAtmosphere: '/api/getAtmosphere',
    exportGarden: '/api/exportGarden',
    getInsightAudio: '/api/getInsightAudio',
    poeticRephrasing: '/api/poeticRephrasing'
  }
};

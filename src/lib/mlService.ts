import path from 'path';
import fs from 'fs';

const MODELS_DIR = process.env.MODELS_DIR || path.join(__dirname, '../../models');
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';

export interface PredictionResult {
  plantName: string;
  confidence: number;
  allPredictions?: Array<{ plant: string; confidence: number }>;
}

export interface MLServiceResponse {
  predicted_class: string;
  confidence: number;
  all_predictions: Array<{ class: string; confidence: number }>;
}

// Call the FastAPI ML service
export async function runMLInference(imagePath: string): Promise<PredictionResult | null> {
  try {
    const FormData = (await import('form-data')).default;
    const axios = (await import('axios')).default;

    const formData = new FormData();
    formData.append('file', fs.createReadStream(imagePath));

    const response = await axios.post<MLServiceResponse>(
      `${ML_SERVICE_URL}/predict`,
      formData,
      {
        headers: formData.getHeaders(),
        timeout: 30000
      }
    );

    return {
      plantName: response.data.predicted_class,
      confidence: response.data.confidence,
      allPredictions: response.data.all_predictions?.map(p => ({
        plant: p.class,
        confidence: p.confidence
      }))
    };
  } catch (error) {
    console.error('ML service error:', error);
    // Fallback: return mock result for development when ML service unavailable
    if (process.env.NODE_ENV === 'development') {
      return getMockPrediction();
    }
    return null;
  }
}

// Development mock when ML service is not running
function getMockPrediction(): PredictionResult {
  const plants = [
    'Aloe Vera', 'Castor', 'Catharanthus', 'Eucalyptus', 'Ginger',
    'Guava', 'Henna', 'Hibiscus', 'Lantana', 'Mango',
    'Mint', 'Neem', 'Onion', 'Papaya', 'Pumpkin'
  ];
  const random = plants[Math.floor(Math.random() * plants.length)];
  const confidence = 0.80 + Math.random() * 0.18; // 80-98%
  return {
    plantName: random,
    confidence: parseFloat(confidence.toFixed(4)),
    allPredictions: plants.slice(0, 5).map((p, i) => ({
      plant: p,
      confidence: parseFloat(Math.max(0.01, confidence - i * 0.1).toFixed(4))
    }))
  };
}

export function getActiveModelPath(): string | null {
  const activeDir = path.join(MODELS_DIR, 'active');
  if (!fs.existsSync(activeDir)) return null;

  const files = fs.readdirSync(activeDir).filter(f =>
    f.endsWith('.keras') || f.endsWith('.h5') || f.endsWith('.tflite')
  );

  if (files.length === 0) return null;
  return path.join(activeDir, files[0]);
}

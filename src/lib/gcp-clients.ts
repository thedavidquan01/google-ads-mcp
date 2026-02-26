/**
 * Google Cloud Platform Client Initialization
 *
 * Initializes authenticated GCP clients (Storage and Firestore) using service account credentials.
 * Gracefully degrades when credentials are not provided.
 */

import { Storage } from '@google-cloud/storage';
import { Firestore } from '@google-cloud/firestore';
import { env } from '../config/env.js';

interface ServiceAccountCredentials {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
  auth_provider_x509_cert_url: string;
  client_x509_cert_url: string;
}

let storage: Storage | null = null;
let firestore: Firestore | null = null;
let isGcpEnabled = false;

function initializeClients() {
  const serviceAccountJson = env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!serviceAccountJson) {
    console.log('GCP credentials not provided. Server will run without video storage and caching features.');
    return;
  }

  try {
    const credentials: ServiceAccountCredentials = JSON.parse(serviceAccountJson);
    const projectId = env.GCP_PROJECT_ID || credentials.project_id;

    if (!projectId) {
      throw new Error('GCP_PROJECT_ID not found in service account JSON or environment variable');
    }

    storage = new Storage({ projectId, credentials });
    firestore = new Firestore({ projectId, credentials });

    isGcpEnabled = true;
    console.log(`GCP clients initialized successfully (project: ${projectId})`);
  } catch (error) {
    console.error('Failed to initialize GCP clients:', error instanceof Error ? error.message : error);
    console.log('Server will continue without GCP features.');
    storage = null;
    firestore = null;
    isGcpEnabled = false;
  }
}

initializeClients();

export { storage, firestore, isGcpEnabled };

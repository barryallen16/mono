import { EventSubscription, requireOptionalNativeModule } from 'expo-modules-core';

export interface CactusStatus {
  supported: boolean;
  abi: string;
  modelsLoadedMask: number;
  whistleLoaded: boolean;
  needleLoaded: boolean;
  whistleCached: boolean;
  needleCached: boolean;
  whistleBytes: number;
  needleBytes: number;
}

export interface CactusProgressEvent {
  model: 'whistle' | 'needle3';
  phase: 'cached' | 'downloading' | 'loading' | 'ready';
  progress: number;
  receivedBytes: number;
  totalBytes: number;
}

export interface CactusTranscribeResult {
  text: string;
  language: string;
  chunks: number;
}

export interface CactusExtractedNote {
  matched: boolean;
  title: string;
  summary: string;
  tags: string[];
  actionItems: string[];
  confidence: number | null;
}

interface CactusNativeModuleType {
  getStatus(): Promise<CactusStatus>;
  prepareModels(): Promise<CactusStatus>;
  clearModels(): Promise<CactusStatus>;
  transcribeFile(uri: string, language?: string | null): Promise<CactusTranscribeResult>;
  extractNote(text: string, localDate: string): Promise<CactusExtractedNote>;
  addListener(
    eventName: 'onModelProgress',
    listener: (event: CactusProgressEvent) => void
  ): EventSubscription;
}

const NativeCactus = requireOptionalNativeModule<CactusNativeModuleType>('CactusNative');

export function isCactusAvailable(): boolean {
  return NativeCactus !== null;
}

export async function getCactusStatus(): Promise<CactusStatus | null> {
  if (!NativeCactus) return null;
  return NativeCactus.getStatus();
}

export async function prepareCactusModels(): Promise<CactusStatus | null> {
  if (!NativeCactus) return null;
  return NativeCactus.prepareModels();
}

export async function clearCactusModels(): Promise<CactusStatus | null> {
  if (!NativeCactus) return null;
  return NativeCactus.clearModels();
}

export async function transcribeWithWhistle(
  uri: string,
  language: string | null = 'en'
): Promise<CactusTranscribeResult | null> {
  if (!NativeCactus) return null;
  return NativeCactus.transcribeFile(uri, language);
}

export async function extractWithNeedle3(
  text: string,
  localDate: string
): Promise<CactusExtractedNote | null> {
  if (!NativeCactus) return null;
  return NativeCactus.extractNote(text, localDate);
}

export function subscribeCactusProgress(
  listener: (event: CactusProgressEvent) => void
): EventSubscription | null {
  if (!NativeCactus) return null;
  return NativeCactus.addListener('onModelProgress', listener);
}

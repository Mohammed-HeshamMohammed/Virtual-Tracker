export type VoicePanel = "participants" | "connection" | "audio" | "camera" | "share" | "activities" | "soundboard";
export type VoiceUiState = {
  camera: boolean; screen: boolean; deafened: boolean; activity?: string; panel?: VoicePanel;
  layout: "grid" | "focus"; spotlight: "participant" | "screen"; names: boolean;
  inputVolume: number; outputVolume: number; soundVolume: number; sensitivity: number;
  inputMode: "Voice activity" | "Push to talk"; pushKey: string; noise: boolean; echo: boolean; autoGain: boolean;
  mirror: boolean; background: "None" | "Blur" | "SoftFix"; cameraQuality: "720p" | "1080p";
  shareSource: "Entire screen" | "Window" | "Browser tab"; shareAudio: boolean; resolution: "720p" | "1080p"; fps: "15" | "30" | "60";
  selectedSound?: string; favorites: string[]; uploadedSounds: string[];
};
export const defaultVoiceUi: VoiceUiState = {
  camera: false, screen: false, deafened: false, layout: "grid", spotlight: "participant", names: true,
  inputVolume: 100, outputVolume: 80, soundVolume: 60, sensitivity: 50,
  inputMode: "Voice activity", pushKey: "Space", noise: true, echo: true, autoGain: true,
  mirror: true, background: "None", cameraQuality: "720p", shareSource: "Entire screen", shareAudio: false, resolution: "1080p", fps: "30", favorites: [], uploadedSounds: [],
};
export const voicePanelTitles: Record<VoicePanel, string> = {
  participants: "People in this room", connection: "Connection details", audio: "Voice & audio", camera: "Camera setup", share: "Share your screen", activities: "Activities", soundboard: "Soundboard",
};
export const voiceActivities = [
  {name: "Focus together", icon: "◷", text: "Make space for uninterrupted work.", category: "Focus"},
  {name: "Quick break", icon: "☕", text: "Step back and catch up.", category: "Social"},
  {name: "Brainstorm", icon: "✧", text: "Collect ideas for the next big thing.", category: "Collaborate"},
  {name: "Team check-in", icon: "☀", text: "Share what is on your mind.", category: "Social"},
];

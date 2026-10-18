export type AvatarCrop = { cx: number; cy: number; zoom: number; ratio: number };

export type ProjectMeta = {
  description: string;
  budget: number;
  due: string;
  resets?: "Never" | "Weekly" | "Monthly";
  notifyAt?: number;
  avatar?: string;
  avatarCrop?: AvatarCrop;
  avatarCredit?: string;
  avatarGlyph?: string;
};

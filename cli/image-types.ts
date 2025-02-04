// Available image types
export type ImageType = "fedora-s6";

// Image type configuration
export interface ImageConfig {
  path: string;  // Path to the image directory
  name: string;  // Human readable name
  description: string;  // Description of the image
}

// Map of available images
export const IMAGES: Record<ImageType, ImageConfig> = {
  "fedora-s6": {
    path: "images/fedora-s6",
    name: "Fedora with s6",
    description: "Fedora 41 with s6-overlay init system"
  }
}; 
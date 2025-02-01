// Available image types
export type ImageType = "ubuntu-s6" | "fedora-systemd";

// Image type configuration
export interface ImageConfig {
  path: string;  // Path to the image directory
  name: string;  // Human readable name
  description: string;  // Description of the image
}

// Map of available images
export const IMAGES: Record<ImageType, ImageConfig> = {
  "ubuntu-s6": {
    path: "images/ubuntu-s6",
    name: "Ubuntu with s6",
    description: "Ubuntu 22.04 with s6 init system"
  },
  "fedora-systemd": {
    path: "images/fedora-systemd",
    name: "Fedora with systemd",
    description: "Fedora 41 with systemd init system"
  }
}; 
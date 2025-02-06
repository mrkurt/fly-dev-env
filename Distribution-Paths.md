# Path Information for Supported Distributions

This document provides detailed path information for each supported distribution, outlining necessary directories for persistent state and system configuration. These paths guide how `/data/state` and `/data/system` should be structured to properly separate runtime state from system binaries and configuration.

## **Common Paths Across All Distros**

### **State Paths (`/data/state/` Bind Mounts)**
- **`/var/lib/`** → Stores persistent data for services (databases, system tools, etc.).
- **`/var/log/`** → System and application logs.
- **`/var/run/` (symlink to `/run/`)** → PID files, runtime sockets.
- **`/var/cache/`** → Cache files that persist across reboots but can be safely cleared.

### **System Paths (`/data/system/` OverlayFS Layers)**
- **`/usr/local/`** → Locally installed binaries and libraries.
- **`/etc/`** → System configuration files.
- **`/opt/`** → Optional software packages.

---

## **Debian & Ubuntu**

### **State Directories**
- `/var/lib/dpkg/` → Stores package installation data.
- `/var/lib/postgresql/` → PostgreSQL database files.
- `/var/lib/mysql/` → MySQL database files.
- `/var/lib/systemd/` → Systemd state information.

### **System Directories**
- `/etc/apt/` → APT package manager configurations.
- `/etc/systemd/system/` → Custom systemd service files.

---

## **Fedora & RHEL-Based**

### **State Directories**
- `/var/lib/rpm/` → RPM database for package management.
- `/var/lib/pgsql/` → PostgreSQL data.
- `/var/lib/dnf/` → DNF package manager state.

### **System Directories**
- `/etc/dnf/` → DNF configuration files.
- `/etc/systemd/system/` → System service configurations.

---

## **Alpine Linux**

### **State Directories**
- `/var/lib/apk/` → Alpine package manager database.
- `/var/lib/postgresql/` → PostgreSQL data.
- `/var/cache/apk/` → APK package cache.

### **System Directories**
- `/etc/apk/` → APK package management configurations.
- `/etc/init.d/` → OpenRC init scripts for services.

---

## **Additional Considerations**
- Some services require empty directories to exist before startup. Ensure pre-start scripts handle creating missing directories.
- Logs and cache files may be automatically rotated or cleared by system tools, so persistent binding strategies should account for this.
- Network configurations, SSH keys, and machine identifiers may also require persistence based on use case.

This document will be updated as needed to refine paths and configurations based on real-world usage.


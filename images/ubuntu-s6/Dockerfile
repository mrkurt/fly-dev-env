FROM ubuntu:22.04

# Install required packages
RUN apt-get update && apt-get install -y \
    curl \
    xz-utils \
    sudo \
    openssh-server \
    openssh-client \
    s6 \
    tzdata \
    && rm -rf /var/lib/apt/lists/*

# Add dev user
RUN useradd -m -s /bin/bash dev && \
    passwd -d dev && \
    passwd -u dev && \
    usermod -aG sudo dev \
    && echo "dev ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/dev \
    && chmod 0440 /etc/sudoers.d/dev

# Set up SSH authorized_keys for dev user
RUN mkdir -p /home/dev/.ssh && \
    chmod 700 /home/dev/.ssh && \
    chown dev:dev /home/dev/.ssh && \
    touch /home/dev/.ssh/authorized_keys && \
    chmod 600 /home/dev/.ssh/authorized_keys && \
    chown dev:dev /home/dev/.ssh/authorized_keys

# Install s6-overlay
ADD https://github.com/just-containers/s6-overlay/releases/download/v3.1.6.2/s6-overlay-noarch.tar.xz /tmp
ADD https://github.com/just-containers/s6-overlay/releases/download/v3.1.6.2/s6-overlay-x86_64.tar.xz /tmp
RUN tar -C / -Jxpf /tmp/s6-overlay-noarch.tar.xz \
    && tar -C / -Jxpf /tmp/s6-overlay-x86_64.tar.xz \
    && rm /tmp/s6-overlay-*.tar.xz

# Configure s6 services
RUN mkdir -p /etc/s6-overlay/s6-rc.d/user/contents.d

# Copy service files
COPY services/container-alive /etc/s6-overlay/s6-rc.d/container-alive
COPY services/sshd /etc/s6-overlay/s6-rc.d/openssh

# Create dependencies
RUN mkdir -p /etc/s6-overlay/s6-rc.d/container-alive/dependencies.d \
    && mkdir -p /etc/s6-overlay/s6-rc.d/openssh/dependencies.d

# Enable services
RUN touch /etc/s6-overlay/s6-rc.d/user/contents.d/container-alive \
    /etc/s6-overlay/s6-rc.d/user/contents.d/openssh

# Configure SSH
COPY services/sshd/sshd_config /etc/ssh/sshd_config

# Copy overlayfs-init script
COPY overlayfs-init /usr/local/bin/overlayfs-init
RUN chmod +x /usr/local/bin/overlayfs-init

# Disable legacy s6 services
ENV S6_BEHAVIOUR_IF_STAGE2_FAILS=2 \
    S6_CMD_RECEIVE_SIGNALS=1 \
    S6_VERBOSITY=0 \
    S6_SERVICES_GRACETIME=0 \
    S6_KILL_GRACETIME=0 \
    S6_LOGGING_SCRIPT="n20 s1000000 T" \
    S6_KEEP_ENV=1 \
    S6_DISABLE_LEGACY=1

ENTRYPOINT ["/usr/local/bin/overlayfs-init"] 
FROM fedora:41

# Install required packages
RUN dnf -y update && \
    dnf -y install --setopt=install_weak_deps=False --nodocs \
    # Core system utilities
    sudo \
    openssh-server \
    openssh-clients \
    curl \
    tar \
    # Development tools and build essentials
    @development-tools \
    # Text editors and terminal tools
    vim \
    tmux \
    # Version control extras
    git-lfs \
    # Data processing and viewing
    jq \
    ripgrep \
    fd-find \
    # Process and system monitoring
    htop \
    lsof \
    procps-ng \
    # Network tools
    bind-utils \
    net-tools \
    iproute \
    # Programming languages and package managers
    python3 \
    python3-pip \
    nodejs \
    npm \
    # Chrome dependencies
    chromium \
    chromium-headless \
    && dnf clean all

# Install minimal s6-overlay
ARG S6_OVERLAY_VERSION=3.1.6.2
RUN curl -L -f https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz -o /tmp/s6-overlay-noarch.tar.xz && \
    curl -L -f https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-x86_64.tar.xz -o /tmp/s6-overlay-x86_64.tar.xz && \
    tar -C / -Jxpf /tmp/s6-overlay-noarch.tar.xz && \
    tar -C / -Jxpf /tmp/s6-overlay-x86_64.tar.xz && \
    rm /tmp/s6-overlay-*.tar.xz

# Configure s6 to use only new s6-rc system
ENV S6_BEHAVIOUR_IF_STAGE2_FAILS=2 \
    S6_CMD_WAIT_FOR_SERVICES_MAXTIME=0 \
    S6_VERBOSITY=1 \
    S6_SERVICES_GRACETIME=0

# Add dev user
RUN useradd -m -s /bin/bash dev && \
    passwd -d dev && \
    passwd -u dev && \
    usermod -aG wheel dev \
    && echo "dev ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/dev \
    && chmod 0440 /etc/sudoers.d/dev

# Set up SSH authorized_keys for both root and dev users
RUN mkdir -p /root/.ssh && \
    chmod 700 /root/.ssh && \
    touch /root/.ssh/authorized_keys && \
    chmod 600 /root/.ssh/authorized_keys && \
    echo "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAII6XUzKPsFke2yz3+SI4e7McC0iI2DfIhZh7/iAy2+xl test-key@fly-dev-env" >> /root/.ssh/authorized_keys && \
    mkdir -p /home/dev/.ssh && \
    chmod 700 /home/dev/.ssh && \
    chown dev:dev /home/dev/.ssh && \
    touch /home/dev/.ssh/authorized_keys && \
    chmod 600 /home/dev/.ssh/authorized_keys && \
    chown dev:dev /home/dev/.ssh/authorized_keys && \
    echo "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAII6XUzKPsFke2yz3+SI4e7McC0iI2DfIhZh7/iAy2+xl test-key@fly-dev-env" >> /home/dev/.ssh/authorized_keys

# Configure SSH
COPY services/sshd/sshd_config /etc/ssh/sshd_config

# Copy s6 service definitions
COPY services/sshd /etc/s6-overlay/s6-rc.d/sshd
COPY services/flyssh /etc/s6-overlay/s6-rc.d/flyssh
COPY services/status /etc/s6-overlay/s6-rc.d/status

# Enable services
RUN mkdir -p /etc/s6-overlay/s6-rc.d/user/contents.d && \
    touch /etc/s6-overlay/s6-rc.d/user/contents.d/sshd && \
    touch /etc/s6-overlay/s6-rc.d/user/contents.d/flyssh && \
    touch /etc/s6-overlay/s6-rc.d/user/contents.d/status

# Make service run scripts executable
RUN chmod +x /etc/s6-overlay/s6-rc.d/*/run /etc/s6-overlay/s6-rc.d/*/check

# Copy overlayfs-init script
COPY overlayfs-init /usr/local/bin/overlayfs-init
RUN chmod +x /usr/local/bin/overlayfs-init

ENTRYPOINT ["/usr/local/bin/overlayfs-init"]
CMD ["/init"] 
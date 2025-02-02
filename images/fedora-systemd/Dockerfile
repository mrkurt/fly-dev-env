FROM fedora:41

# Install required packages
RUN dnf -y update && dnf -y install --skip-unavailable \
    systemd \
    sudo \
    openssh-server \
    openssh-clients \
    # Chrome dependencies
    chromium \
    chromium-headless \
    && dnf clean all

# Clean up unnecessary systemd services before configuring our own
RUN rm -f /lib/systemd/system/multi-user.target.wants/* \
    /etc/systemd/system/*.wants/* \
    /lib/systemd/system/local-fs.target.wants/* \
    /lib/systemd/system/sockets.target.wants/*udev* \
    /lib/systemd/system/sockets.target.wants/*initctl* \
    /lib/systemd/system/sysinit.target.wants/systemd-tmpfiles-setup* \
    /lib/systemd/system/systemd-update-utmp*

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

# Configure systemd defaults
COPY system.conf /etc/systemd/system.conf

# Configure systemd logging and status reporting
COPY services/show-status.service /etc/systemd/system/show-status.service
RUN systemctl enable show-status.service

# Install flyssh service
COPY services/flyssh /tmp/flyssh
RUN /tmp/flyssh/install.sh && rm -rf /tmp/flyssh

# Copy overlayfs-init script
COPY overlayfs-init /usr/local/bin/overlayfs-init
RUN chmod +x /usr/local/bin/overlayfs-init

# Enable systemd services
RUN systemctl enable sshd

# Use systemd as entrypoint
ENTRYPOINT ["/usr/local/bin/overlayfs-init"]
CMD ["/usr/sbin/init", "systemd.log_level=debug", "systemd.log_target=console"] 
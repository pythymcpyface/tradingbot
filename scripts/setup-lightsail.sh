#!/bin/bash
set -e

echo "Starting Lightsail setup..."

# Update and install dependencies
sudo apt-get update
sudo apt-get install -y \
    apt-transport-https \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    awscli \
    jq

# Install Docker
if ! command -v docker &> /dev/null; then
    echo "Installing Docker..."
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor --batch --yes -o /usr/share/keyrings/docker-archive-keyring.gpg
    echo \
      "deb [arch=amd64 signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu \
      $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

    # Fix any previous broken installs first
    sudo apt-get --fix-broken install -y

    # Clean apt cache to fix 404 errors
    sudo rm -rf /var/lib/apt/lists/*
    sudo apt-get update
    
    # Install containerd.io first to verify it works
    sudo apt-get install -y containerd.io || {
         echo "Standard install failed, trying to find available versions..."
         apt-cache madison containerd.io
         # Fallback to previous known stable version if latest fails
         sudo apt-get install -y containerd.io=1.6.28-1
    }
    
    # Now install the rest
    sudo apt-get install -y docker-ce docker-ce-cli
else
    echo "Docker already installed."
fi

# Add ubuntu user to docker group
sudo usermod -aG docker ubuntu

# Create data directory
mkdir -p /home/ubuntu/data
sudo chown -R ubuntu:ubuntu /home/ubuntu/data

# Configure AWS Region
aws configure set region eu-west-2

echo "Setup complete! Please log out and back in for docker group changes to take effect."

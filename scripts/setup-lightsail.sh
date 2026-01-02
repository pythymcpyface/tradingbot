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
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
    echo \
      "deb [arch=amd64 signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu \
      $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

    sudo apt-get update
    # Try installing with fix-missing to handle transient network issues
    sudo apt-get install -y --fix-missing docker-ce docker-ce-cli containerd.io || {
        echo "Install failed, retrying update and install..."
        sudo apt-get update
        sudo apt-get install -y docker-ce docker-ce-cli containerd.io
    }
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

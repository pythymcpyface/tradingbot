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
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io
else
    echo "Docker already installed."
fi

# Add ubuntu user to docker group
sudo usermod -aG docker ubuntu

# Create data directory
mkdir -p /home/ubuntu/data
sudo chown -R ubuntu:ubuntu /home/ubuntu/data

# Configure AWS Region
aws configure set region ap-southeast-1

echo "Setup complete! Please log out and back in for docker group changes to take effect."

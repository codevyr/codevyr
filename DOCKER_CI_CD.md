# Docker CI/CD Pipeline Documentation

## Overview

This repository includes a comprehensive GitHub Actions workflow for building and deploying Docker images with security scanning, testing, and cleanup policies.

## Workflow Features

### 🔄 **Automated Triggers**
- **Main Branch**: Builds and pushes on every commit to `main`
- **Pull Requests**: Builds images for PRs to validate changes
- **Path Filtering**: Only triggers on relevant file changes (source code, configs, Dockerfile)

### 🏗️ **Multi-Stage Pipeline**
1. **Lint and Test**: Code quality checks and build validation
2. **Security Scan**: Vulnerability scanning of dependencies and filesystem
3. **Build and Push**: Multi-architecture Docker image creation
4. **Image Scan**: Security scanning of the built container image
5. **Cleanup**: Automatic removal of old image versions

### 🏷️ **Image Tagging Strategy**
- **Main branch**: `latest`, `main-<sha>`
- **Pull requests**: `pr-<number>`, `pr-<number>-<sha>`
- **Feature branches**: `<branch>-<sha>`

### 🔒 **Security Features**
- **Dependency Audit**: `npm audit` for known vulnerabilities
- **Filesystem Scan**: Trivy scans source code for security issues
- **Container Scan**: Trivy scans the final Docker image
- **SARIF Upload**: Results uploaded to GitHub Security tab
- **Multi-arch Support**: Builds for `linux/amd64` and `linux/arm64`

### 🚀 **Performance Optimizations**
- **Build Cache**: GitHub Actions cache for Docker layers
- **Multi-stage Build**: Optimized Dockerfile with layer caching
- **Parallel Jobs**: Lint/test and security scans run in parallel
- **Path Filtering**: Only builds when relevant files change

## Configuration

### Required Secrets
No additional secrets required - uses `GITHUB_TOKEN` for registry access.

### Registry Configuration
- **Registry**: GitHub Container Registry (ghcr.io)
- **Image Name**: `ghcr.io/codevyr/askl-react`
- **Permissions**: Automatically granted through `GITHUB_TOKEN`

### Cleanup Policy
- **Retention**: Keeps 10 most recent versions
- **Untagged Images**: Automatically deleted
- **Trigger**: Only runs on main branch pushes

## Image Usage

### Pull the Latest Image
```bash
# Latest stable version (main branch)
docker pull ghcr.io/codevyr/askl-react:latest

# Specific PR version
docker pull ghcr.io/codevyr/askl-react:pr-123

# Specific commit
docker pull ghcr.io/codevyr/askl-react:main-abc1234
```

### Run the Container
```bash
# Basic run
docker run -p 3000:3000 ghcr.io/codevyr/askl-react:latest

# With environment variables
docker run -p 3000:3000 \
  -e NODE_ENV=production \
  ghcr.io/codevyr/askl-react:latest

# With health checks
docker run -p 3000:3000 --health-interval=30s \
  ghcr.io/codevyr/askl-react:latest
```

## Local Development

### Build Locally
```bash
# Build the image
docker build -t askl-react:local .

# Run locally built image
docker run -p 3000:3000 askl-react:local
```

### Test the Workflow Locally
```bash
# Install act (GitHub Actions local runner)
# brew install act  # macOS
# curl https://raw.githubusercontent.com/nektos/act/master/install.sh | sudo bash  # Linux

# Run the workflow locally
act push -W .github/workflows/docker-build.yml
```

## Monitoring

### GitHub Security Tab
- View vulnerability scan results
- Track security advisories
- Monitor dependency alerts

### GitHub Packages
- View all published images
- Check download statistics
- Manage image versions

### Workflow Runs
- Monitor build status
- Debug failed builds
- View build logs and artifacts

## Customization

### Modify Build Triggers
Edit `.github/workflows/docker-build.yml`:
```yaml
on:
  push:
    branches: [main, develop]  # Add more branches
    paths: ['src/**', '...']    # Modify watched paths
```

### Change Registry
```yaml
env:
  REGISTRY: your-registry.com
  IMAGE_NAME: your-org/askl-react
```

### Adjust Security Scanning
```yaml
- name: Run npm audit
  run: npm audit --audit-level=high  # Change severity level
```

### Modify Cleanup Policy
```yaml
- name: Delete old container images
  with:
    min-versions-to-keep: 20  # Keep more versions
    delete-only-untagged-versions: false  # Delete tagged versions too
```

## Troubleshooting

### Common Issues

1. **Build Failures**: Check the "Lint and Test" job logs
2. **Security Failures**: Review the Security tab for vulnerability details
3. **Push Failures**: Verify repository permissions and token scope
4. **Image Pull Failures**: Ensure you're authenticated with the registry

### Debug Commands
```bash
# Check image details
docker inspect ghcr.io/codevyr/askl-react:latest

# View image history
docker history ghcr.io/codevyr/askl-react:latest

# Scan image locally
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  aquasec/trivy:latest image ghcr.io/codevyr/askl-react:latest
```

## Best Practices Implemented

✅ **Security First**: Multi-layer vulnerability scanning
✅ **Performance**: Optimized caching and multi-stage builds  
✅ **Reliability**: Comprehensive testing before deployment
✅ **Maintainability**: Automatic cleanup and clear documentation
✅ **Observability**: Detailed logging and monitoring integration
✅ **Standards Compliance**: Follows OCI image specifications
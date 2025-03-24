# Custom Domains and SSL Support for WordPress Studio

## About this doc

This document outlines the design and implementation details for adding custom domain and SSL support to WordPress Studio. It covers the high-level approach, data flow, risks, and mitigation strategies for this feature.

## Context

WordPress Studio added support for custom domains with SSL/HTTPS capability, enabling developers to create local WordPress development environments that more closely mimic production environments. This feature allows users to access their local WordPress sites using domain names (e.g., `mysite.wp.local`) instead of localhost with port numbers, and secure them with SSL certificates.

This enhancement aims to improve the local development experience by providing more realistic testing environments and enabling developers to test features that require proper domains and HTTPS.

Some WordPress plugins and themes require specific domain names or HTTPS to function correctly. By supporting custom domains and SSL, WordPress Studio can better accommodate these requirements and provide a more seamless development experience.

## Non-goals

The following items are deliberately out of scope for this project:

### Supporting domains outside the `.local` TLD

We're restricting custom domains to the `.local` TLD to prevent potential security issues and to maintain clear separation between development and production environments.

### Automatically trusting certificates on all platforms

While we provide helpers and documentation for trusting certificates, we won't force installation of the root certificate authority without user consent or on platforms where this is restricted (MacOS).

### Supporting wildcard certificates

Each site will have its own dedicated certificate rather than using wildcard certificates.

## Terminology

- **Custom Domain**: A user-defined domain name (e.g., `mysite.wp.local`) that resolves to the local WordPress site.
- **Root Certificate Authority (CA)**: A self-signed certificate that the application generates to sign individual site certificates.
- **SNI (Server Name Indication)**: An extension to the TLS protocol that allows a server to present multiple certificates on the same IP address and port.
- **Hosts File**: A system file that maps hostnames to IP addresses, used here to resolve custom domains to localhost (127.0.0.1).

## High level approach

The implementation uses a multi-layered approach:

1. A proxy server listens on standard HTTP/HTTPS ports (80/443) and forwards requests to the appropriate WordPress site based on the requested domain.
2. The system hosts file is modified to resolve custom domain names to localhost (127.0.0.1).
3. A certificate management system generates and manages a root CA and site-specific certificates for HTTPS support.
4. UI components allow users to configure custom domains and HTTPS settings when creating or editing sites.

When a site with a custom domain is accessed, the proxy server handles the request, determining the correct local WordPress instance based on the domain name. For HTTPS, an SNI-enabled server provides the appropriate certificate for the requested domain.

### Data Flow

1. When a user enables a custom domain:
   - Domain is validated and added to the site configuration
   - An entry is added to the hosts file mapping the domain to 127.0.0.1
   - If HTTPs is enabled and no root CA exists, one is created and stored on the system. For windows, the root CA is added to the system trust store. But For MacOS, the user is prompted to install the root CA manually.
   - If HTTPS is enabled, site certificates are generated

2. When a request arrives at the proxy server:
   - The server extracts the domain from the request
   - Looks up the corresponding site in the user data
   - If found, forwards the request to the appropriate local port
   - For HTTPS requests, serves the correct certificate using SNI

3. When a site is deleted or a domain is changed:
   - Old domain entries are removed from the hosts file
   - Old domain certificates remain are removed

## Risks

### Proxy server requires standard ports

**Risk**: The proxy server requires ports 80 and 443, which might already be in use on the user's system.

**Mitigation**: Provide clear error messages when ports are unavailable and document alternative approaches (like stopping other services temporarily).

### Certificate trust requires administrative privileges

**Risk**: Installing the root CA certificate in the system trust store requires administrative privileges and user interaction.

**Mitigation**: Provide clear instructions and helper utilities to guide users through the process, with documentation for all supported platforms.

### Modifying hosts file requires elevated permissions

**Risk**: Adding entries to the system hosts file requires administrative privileges, potentially prompting security warnings.

**Mitigation**: Use a trusted sudo prompting library, provide clear explanations about what's happening, and isolate WordPress Studio entries in a dedicated section of the hosts file.

### Local domains could conflict with real domains

**Risk**: The root CA could sign certificates for real domains, potentially causing conflicts or security issues.

**Mitigation**: Restrict domains to the `.local` TLD which is reserved for local usage, and validate domain names to prevent conflicts.

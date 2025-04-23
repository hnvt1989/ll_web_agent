FROM node:20

# Set up global binary location for PNPM
ENV PNPM_HOME=/usr/local/pnpm
ENV PATH=$PNPM_HOME:$PATH

# Enable and install PNPM via Corepack
RUN corepack enable && corepack prepare pnpm@latest --activate

# Set up the PNPM global bin directory
RUN mkdir -p $PNPM_HOME && \
    pnpm config set global-bin-dir $PNPM_HOME

# Install Playwright MCP globally
RUN pnpm add -g @playwright/mcp@latest

# Expose default MCP port (adjust if needed)
EXPOSE 59985

# Start the correct MCP server binary
#CMD ["mcp-server-playwright"]
CMD ["mcp-server-playwright", "--browser", "chromium", "--port", "59985", "--headless"]


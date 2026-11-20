FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY bin ./bin
RUN chmod +x ./bin/dropbg-mcp.mjs
ENTRYPOINT ["node", "./bin/dropbg-mcp.mjs"]

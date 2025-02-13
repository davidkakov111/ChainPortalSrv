FROM node:22-bullseye

# Set working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json to install dependencies
COPY package*.json ./

# Copy prisma file bc needed for npm install
COPY prisma ./prisma

# Install dependencies
RUN npm install

# Copy the rest of the app's source code
COPY . .

# Build the app
RUN npm run build

# Expose the port Nest.js will run on
EXPOSE 3000

# Start the app
CMD ["npm", "run", "start:prod"]

# To remove containers, volumes, etc., run the following command:
# sudo docker compose down --volumes --rmi all
# To list volumes, use the following command by changing the word "volume":
# sudo docker volume ls

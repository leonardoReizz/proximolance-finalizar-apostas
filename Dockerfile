FROM node:22-alpine

WORKDIR /app

COPY package.json .

COPY . .

RUN yarn install
RUN yarn build

EXPOSE 4000

CMD ["yarn", "start"]
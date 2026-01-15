FROM node:20

WORKDIR /usr/src/app

COPY package.json yarn.lock ./

ENV NODE_ENV=production

RUN yarn install

COPY . .

RUN yarn build

EXPOSE 5000

CMD ["yarn", "start"]
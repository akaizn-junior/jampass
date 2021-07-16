const faker = require('faker');
const path = require('path');

const jesse = require('../src/jesse');

jesse.funnel(() => {
  const fakeData = [];
  const fakeItemsCount = 150;

  faker.seed(fakeItemsCount);

  for (let i = 0; i < fakeItemsCount; i++) {
    const date = faker.date.recent(3);
    fakeData.push({
      name: faker.name.firstName(),
      description: faker.lorem.words(3),
      breed: faker.animal.cat(),
      insertedAt: `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`,
      photo: faker.image.dataUri(500, 500, '#161616')
    });
  }

  const date = faker.date.recent(3);
  fakeData.push({
    name: faker.name.firstName(),
    description: 'Doggo surprise',
    breed: faker.animal.dog(),
    insertedAt: `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`,
    photo: faker.image.dataUri(500, 500, '#161616')
  });

  return fakeData;
});

module.exports = {
  site: {
    name: 'Adopt Cats'
  },
  views: {
    path: path.join(__dirname, 'cats', 'views')
  },
  assets: {
    whitelist: ['camo.githubusercontent.com']
  },
  output: {
    filename: {
      cat: '-[insertedAt]/[name]/',
      dog: '[name.10]/'
    }
  }
};

const faker = require('faker');
const path = require('path');
const jesse = require('../src/jesse');

jesse.funnel(() => {
  const fakeData = [];
  const fakeItemsCount = 4;

  faker.seed(fakeItemsCount);

  for (let i = 0; i < fakeItemsCount; i++) {
    const date = faker.date.recent(3);
    fakeData.push({
      name: faker.name.firstName(),
      description: faker.lorem.words(3),
      breed: faker.animal.cat(),
      insertedAt: `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`,
      // photo: faker.image.dataUri(500, 500, '#161616')
      photo: faker.image.animals(500, 500, true)
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
  cwd: path.join(__dirname, 'cats'),
  site: {
    name: 'Adopt Animals',
    author: 'Kat McMeowsface'
  },
  locales: [{
    lang: 'en-US',
    entry: '/',
    contents: 'locales/en_US.json'
  }, {
    lang: 'pt-AO',
    entry: '/pt_ao',
    contents: 'locales/pt_AO.json'
  }],
  build: {
    mode: jesse.JESSE_BUILD_MODE_LAZY
  },
  assets: {
    trust: ['placeimg.com']
  },
  output: {
    filename: {
      'cat.html': '-[insertedAt]/[name]/',
      'pt_ao/cat.html': '-pt_ao/[insertedAt]/[name]/',
      dog: '[name.1]/'
    }
  }
};

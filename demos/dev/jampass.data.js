import faker from 'faker';

const fakeData = [];
const fakeItemsCount = 25;
const colors = ['pink', 'black', 'red', '#9b870c', 'orange', 'purple'];

faker.seed(fakeItemsCount);

for (let i = 0; i < fakeItemsCount; i++) {
  const date = faker.date.recent(2);

  fakeData.push({
    name: faker.name.firstName(),
    description: faker.lorem.words(500),
    breed: faker.animal.cat(),
    insertedAt: `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`,
    photo: faker.image.dataUri(500, 500, colors[faker.datatype.number(colors.length)])
  });
}

export default {
  raw: fakeData,
  // pagination: {
  //   every: 5
  // },
  indexes: [
    'name',
    'breed',
    'description'
  ]
};

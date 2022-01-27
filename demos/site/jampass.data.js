import faker from 'faker';

const fakeData = [];
const fakeItemsCount = 100;
const colors = ['blue', 'black', 'red', 'cyan', 'orange', 'purple'];

faker.seed(fakeItemsCount);

for (let i = 0; i < fakeItemsCount; i++) {
  const date = faker.date.recent(2);

  fakeData.push({
    name: faker.name.firstName(),
    description: faker.lorem.words(3),
    breed: faker.animal.cat(),
    insertedAt: `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`,
    photo: faker.image.dataUri(500, 500, colors[faker.datatype.number(colors.length)])
  });
}

const date = faker.date.recent(5);
fakeData.push({
  name: faker.name.firstName(),
  description: 'Doggo surprise',
  breed: faker.animal.dog(),
  insertedAt: `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`,
  photo: faker.image.dataUri(500, 500, colors[faker.datatype.number(colors.length)])
});

export default {
  data: fakeData
};

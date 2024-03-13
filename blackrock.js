const {Elf} = require('xcraft-core-goblin');
const {Blackrock, BlackrockLogic} = require('./lib/blackrock.js');

exports.xcraftCommands = Elf.birth(Blackrock, BlackrockLogic);

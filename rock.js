const {Elf} = require('xcraft-core-goblin');
const {Rock, RockLogic} = require('./lib/rock.js');

exports.xcraftCommands = Elf.birth(Rock, RockLogic);

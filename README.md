# 📘 goblin-blackrock

## Aperçu

Le module `goblin-blackrock` est un système robuste de gestion d'appels asynchrones avec stratégie de réessai automatique dans l'écosystème Xcraft. Il permet d'exécuter des tâches (quêtes Xcraft) de manière fiable, même en cas d'échec temporaire, en réessayant automatiquement toutes les 30 secondes selon une stratégie configurable. Ce module est particulièrement utile pour les opérations qui nécessitent une garantie d'exécution dans un environnement distribué ou sujet à des défaillances transitoires.

## Sommaire

- [Structure du module](#structure-du-module)
- [Fonctionnement global](#fonctionnement-global)
- [Exemples d'utilisation](#exemples-dutilisation)
- [Interactions avec d'autres modules](#interactions-avec-dautres-modules)
- [Détails des sources](#détails-des-sources)
- [Licence](#licence)

## Structure du module

Le module est composé de deux acteurs principaux implémentés selon le modèle Elf du framework Xcraft :

1. **Blackrock** — Un acteur singleton (`Elf.Alone`) qui orchestre globalement les appels asynchrones. Il est le point d'entrée public du module.
2. **Rock** — Un acteur instanciable (`Elf`) persisté via `Elf.Archetype` qui représente un appel spécifique à exécuter avec sa stratégie de réessai.

Ces acteurs suivent une architecture claire avec séparation entre la logique métier (`BlackrockLogic`, `RockLogic`) et l'état (`BlackrockState`, `RockState`).

La classe interne `Launcher` (non exposée publiquement) gère l'exécution concrète des tentatives via un `EventEmitter`.

## Fonctionnement global

Le système fonctionne sur le principe de « lancer des roches » (_hurl rocks_) représentant des appels à des quêtes Xcraft :

```
[Client]
   │
   ▼
Blackrock.hurl(baseId, eventScope, goblinName, questName, params, retries)
   │
   ├─► Crée/récupère un Rock (rock@<baseId>)
   │       │
   │       └─► Persiste l'état dans la DB 'rock'
   │
   └─► Rock.process()
           │
           └─► Launcher (EventEmitter)
                   │
                   ├─► Exécute quest.cmd(`${goblinName}.${questName}`, params)
                   │       ├── Succès ──► Rock.done() ──► evt(<kill-the-rock>)
                   │       │                           ──► evt(<eventScope-rock-processed>)
                   │       └── Échec ──► Rock.setError()
                   │                 ──► evt(<eventScope-rock-processed>, {error})
                   │                 └── Réessai après 30s (si retries > 0 ou infini)
                   │
                   └─► BlackrockAbortError ──► Arrêt immédiat (pas de réessai)
```

**Au démarrage**, `Blackrock.init()` interroge la base de données pour récupérer tous les rocks non traités (`processed = false`) ayant encore des tentatives disponibles (`retries != 0`), et relance leur traitement. En mode `development`, ce comportement est désactivé.

**L'interruption** d'un appel en cours se fait via `Blackrock.break()`, qui marque le Rock comme `trashed` et stoppe le `Launcher`.

**L'annulation définitive** d'un appel (depuis la quête cible elle-même) est possible en levant une `BlackrockAbortError`, qui provoque l'arrêt immédiat sans nouvelle tentative.

## Exemples d'utilisation

### Lancer un appel avec réessai automatique

```javascript
const {Blackrock} = require('goblin-blackrock');

// Dans une méthode d'un acteur Elf
async hurlSomething() {
  const blackrock = new Blackrock(this);

  // Souscrire aux notifications de résultat
  this.quest.sub('<myEventScope-rock-processed>', (err, {msg}) => {
    const {baseId, result, error} = msg.data;
    if (error) {
      console.error(`Operation ${baseId} failed:`, error);
    } else {
      console.log(`Operation ${baseId} succeeded:`, result);
    }
  });

  // Lancer avec 5 tentatives maximum
  await blackrock.hurl(
    'my-operation-id',   // ID de base
    'myEventScope',      // Portée d'événement pour les notifications
    'myGoblin',          // Nom du goblin cible
    'doSomething',       // Nom de la quête à exécuter
    {param1: 'value1'},  // Paramètres de la quête
    5                    // Nombre de tentatives (null/undefined = infini)
  );
}
```

### Annuler un appel en cours

```javascript
const blackrock = new Blackrock(this);
await blackrock.break('my-operation-id');
```

### Interrompre définitivement depuis la quête cible

```javascript
const {BlackrockAbortError} = require('goblin-blackrock');

// Dans la quête ciblée par un Rock
async doSomething(quest, params) {
  try {
    // ...
  } catch (ex) {
    // Lever cette erreur pour stopper les réessais
    throw new BlackrockAbortError(ex);
  }
}
```

## Interactions avec d'autres modules

- **[xcraft-core-goblin]** — Fournit les abstractions `Elf`, `Elf.Alone`, `Elf.Archetype`, `Elf.Spirit` et `SmartId` utilisés pour définir les acteurs et gérer leur état.
- **[xcraft-core-stones]** — Fournit les types (`string`, `boolean`, `number`, `option`, `object`, `enumeration`) utilisés dans les shapes.
- **[xcraft-core-utils]** — Dépendance utilitaire de base du framework Xcraft.
- **Système de persistance Cryo** — Utilisé pour stocker et requêter les rocks (`RockLogic.db = 'rock'`), permettant la reprise après redémarrage.
- **Bus Xcraft** — Les événements `<kill-the-rock>` et `<eventScope-rock-processed>` sont propagés sur le bus pour coordonner les acteurs.

## Détails des sources

### `blackrock.js`

Point d'entrée du module qui expose les commandes Xcraft de l'acteur `Blackrock` via `Elf.birth()`. Ce fichier permet au serveur Xcraft de charger automatiquement l'acteur sur le bus au démarrage.

### `rock.js`

Point d'entrée qui expose les commandes Xcraft de l'acteur `Rock` via `Elf.birth()`.

### `lib/blackrock.js`

Définit l'acteur singleton `Blackrock` (`Elf.Alone`) et sa logique `BlackrockLogic`. C'est le point d'entrée public pour les consommateurs du module.

#### État et modèle de données

L'état de `Blackrock` est intentionnellement minimal :

```javascript
class BlackrockShape {
  id = string; // Toujours 'blackrock'
}
```

#### Méthodes publiques

- **`init()`** — Initialisation du singleton au démarrage. Interroge la base de données `rock` pour récupérer les rocks non traités ayant encore des tentatives disponibles et relance leur traitement. Configure la souscription à l'événement global `*::*.<kill-the-rock>` pour nettoyer les acteurs Rock terminés. Désactivée en mode `NODE_ENV=development`.
- **`hurl(baseId, eventScope, goblinName, questName, params, retries)`** — Lance un nouvel appel asynchrone avec stratégie de réessai. Construit l'ID `rock@<baseId>` via `SmartId`, crée un acteur `Rock`, configure ses paramètres via `upsert` et démarre le traitement. Le paramètre `retries` peut être `null` ou `undefined` pour des tentatives infinies.
- **`break(baseId)`** — Annule un appel en cours. Vérifie d'abord l'existence du Rock dans la DB, appelle `rock.trash()` et différe la suppression de l'acteur via `quest.defer`.

#### `BlackrockAbortError`

Classe d'erreur exportée permettant d'interrompre définitivement un Rock sans nouveaux réessais :

```javascript
const {BlackrockAbortError} = require('goblin-blackrock');
throw new BlackrockAbortError(originalError);
```

Propriétés : `name` (`'BlackrockAbortError'`), `message`, `code`, `stack`, `exception` (erreur originale).

### `lib/rock.js`

Contient la logique principale du système : l'acteur `Rock`, sa logique de persistance `RockLogic` et la classe interne `Launcher`.

#### État et modèle de données

```javascript
class MetaShape {
  status = enumeration('published', 'trashed');
}

class RockShape {
  id = string; // Identifiant unique (rock@<baseId>)
  meta = MetaShape; // Métadonnées : statut 'published' | 'trashed'
  eventScope = string; // Portée d'événement pour les notifications
  goblinName = string; // Nom du goblin cible
  questName = string; // Nom de la quête à exécuter
  params = option(object); // Paramètres de la quête (optionnel)
  processed = boolean; // true si l'appel a réussi
  retries = option(number); // Nombre de tentatives restantes (null = infini)
  error = option(string); // Dernière erreur rencontrée (optionnel)
}
```

La base de données utilisée est `'rock'` (`RockLogic.db = 'rock'`).

#### Méthodes publiques de `Rock`

- **`create(id, desktopId)`** — Crée un nouveau Rock avec l'ID spécifié et le persiste immédiatement. Retourne `this` pour le chaînage.
- **`upsert(eventScope, goblinName, questName, params, retries)`** — Met à jour les paramètres du Rock et réinitialise son état (`processed = false`, `status = 'published'`). Retourne `false` si le Rock est déjà en cours de traitement, `true` sinon.
- **`process(initialDelay = false)`** — Démarre l'exécution via un `Launcher`. Si `initialDelay` est `true`, attend 30 secondes avant la première tentative. Sans effet si déjà en cours de traitement.
- **`done()`** — Marque le Rock comme traité avec succès, supprime l'erreur et émet `<kill-the-rock>` pour déclencher la suppression de l'acteur.
- **`setError(error)`** — Enregistre l'erreur de la dernière tentative et persiste l'état.
- **`trash()`** — Arrête le `Launcher`, passe le statut à `'trashed'` et émet `<kill-the-rock>`.
- **`delete()`** — Arrête le `Launcher` (appelé lors de la suppression de l'acteur).
- **`dispose()`** — Arrête le `Launcher` lors de la fermeture de l'application.

#### Classe `Launcher` (interne)

`Launcher` étend `EventEmitter` et gère l'exécution des appels avec réessai automatique.

Comportement clé :

- **Intervalle de réessai** : 30 secondes (`#timeInterval = 30000`) entre chaque tentative
- **Délai initial** : optionnel, retarde la première tentative de 30 secondes
- **Protection contre les exécutions concurrentes** : le flag `#running` empêche les appels parallèles
- **Stratégie de réessai** : si `retries` est un nombre, il est décrémenté à chaque échec ; si `retries` vaut 0 après décrémentation, les réessais s'arrêtent. Si `retries` est `null`/`undefined`, les réessais sont infinis
- **Abort sans réessai** : une `BlackrockAbortError` stoppe immédiatement les réessais
- **Événements émis** : `'success'` (avec le résultat) et `'error'` (avec l'exception)

## Licence

Ce module est distribué sous [licence MIT](./LICENSE).

---

_Ce contenu a été généré par IA_

[xcraft-core-goblin]: https://github.com/Xcraft-Inc/xcraft-core-goblin
[xcraft-core-stones]: https://github.com/Xcraft-Inc/xcraft-core-stones
[xcraft-core-utils]: https://github.com/Xcraft-Inc/xcraft-core-utils

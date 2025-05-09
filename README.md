# 📘 Documentation du module goblin-blackrock

## Aperçu

Le module `goblin-blackrock` est un système robuste de gestion d'appels asynchrones avec stratégie de réessai automatique dans l'écosystème Xcraft. Il permet d'exécuter des tâches (quêtes) de manière fiable, même en cas d'échec temporaire, en réessayant automatiquement selon une stratégie configurable. Ce module est particulièrement utile pour les opérations qui nécessitent une garantie d'exécution dans un environnement distribué ou sujet à des défaillances.

## Structure du module

Le module est composé de deux acteurs principaux implémentés selon le modèle Elf du framework Xcraft :

1. **Blackrock** - Un acteur singleton (`Elf.Alone`) qui gère l'orchestration globale des appels asynchrones
2. **Rock** - Un acteur instanciable (`Elf`) qui représente un appel spécifique à exécuter avec sa stratégie de réessai

Ces acteurs suivent une architecture claire avec séparation entre la logique métier (classes `BlackrockLogic` et `RockLogic`) et l'état (classes `BlackrockState` et `RockState`).

## Fonctionnement global

Le système fonctionne sur le principe de "lancer des roches" (hurl rocks) qui représentent des appels à des quêtes spécifiques :

1. Lorsqu'un appel doit être effectué avec une stratégie de réessai, `Blackrock` crée un nouvel acteur `Rock`
2. Le `Rock` encapsule les détails de l'appel (goblin cible, nom de la quête, paramètres) et sa stratégie de réessai
3. Un `Launcher` interne (implémenté comme une classe `EventEmitter`) gère l'exécution de l'appel et les tentatives de réessai en cas d'échec
4. Les événements de succès ou d'échec sont émis pour permettre aux consommateurs de réagir en conséquence
5. Les `Rock` sont persistés dans une base de données (via `Elf.Archetype`), ce qui permet de reprendre les appels non traités après un redémarrage

Le module utilise un système d'événements pour notifier les consommateurs du résultat des appels, qu'ils soient réussis ou échoués, en émettant des événements dans le format `<eventScope-rock-processed>`.

## Exemples d'utilisation

### Lancer un appel avec réessai automatique

```javascript
const {Blackrock} = require('goblin-blackrock/lib/blackrock.js');

// Dans une méthode d'un acteur Elf
async hurlSomething() {
  // Obtenir une référence à l'acteur Blackrock
  const blackrock = new Blackrock(this);

  // Écouter le résultat
  this.quest.sub(`<myEventScope-rock-processed>`, (err, {msg}) => {
    const {baseId, result, error} = msg.data;
    if (error) {
      // Gérer l'erreur après épuisement des tentatives
    } else {
      // Traiter le résultat en cas de succès
    }
  });

  // Lancer un appel avec réessai
  await blackrock.hurl(
    'my-operation-id',           // ID de base pour cette opération
    'myEventScope',              // Portée d'événement pour les notifications
    'myGoblin',                  // Nom du goblin cible
    'doSomething',               // Nom de la quête à exécuter
    {param1: 'value1'},          // Paramètres de la quête
    5                            // Nombre de tentatives (undefined pour infini)
  );
}
```

### Annuler un appel en cours

```javascript
const {Blackrock} = require('goblin-blackrock/lib/blackrock.js');

// Dans une méthode d'un acteur Elf
async breakSomething() {
  // Obtenir une référence à l'acteur Blackrock
  const blackrock = new Blackrock(this);

  // Annuler un appel en cours
  await blackrock.break('my-operation-id');
}
```

## Interactions avec d'autres modules

- [**xcraft-core-goblin**][1] : Utilise le framework Elf pour la définition des acteurs et la gestion de l'état
- [**xcraft-core-stones**][2] : Utilise les types de données pour définir les formes (shapes) des états
- **Système d'événements Xcraft** : Utilise les événements pour notifier les consommateurs des résultats
- **Système de persistance Cryo** : Utilise la persistance pour stocker et récupérer les rocks non traités

Le module s'intègre dans l'écosystème Xcraft en fournissant une abstraction pour les appels asynchrones fiables, utilisable par n'importe quel autre service ou goblin.

## Détails des sources

### `blackrock.js`

Ce fichier définit l'acteur `Blackrock` et sa logique associée `BlackrockLogic`. En tant que singleton (`Elf.Alone`), il est responsable de l'orchestration des appels asynchrones avec réessai. Il offre les fonctionnalités principales :

- **init()** : Initialise l'acteur et récupère les rocks non traités pour reprendre leur exécution
- **hurl()** : Crée et lance un nouvel appel asynchrone avec stratégie de réessai
- **break()** : Annule un appel en cours

L'acteur s'abonne également aux événements `<kill-the-rock>` pour nettoyer les ressources lorsqu'un rock a terminé son exécution.

La méthode `init()` utilise le système de requêtes Cryo pour rechercher les rocks non traités (où `processed` est `false` et `retries` n'est pas `0`) et relance leur traitement.

### `rock.js`

Ce fichier définit l'acteur `Rock` qui représente un appel spécifique à exécuter avec sa stratégie de réessai. Il contient :

- **RockShape/RockState** : Définit la structure de données d'un rock, incluant l'identifiant, le statut, les paramètres d'appel et l'état d'exécution
- **RockLogic** : Contient la logique métier pour créer, mettre à jour et gérer l'état d'un rock
- **Rock** : L'acteur qui encapsule la logique et l'état, et gère l'exécution de l'appel via un `Launcher`
- **Launcher** : Une classe interne qui gère l'exécution effective de l'appel et implémente la stratégie de réessai

Les méthodes principales de l'acteur Rock sont :

- **create()** : Crée un nouveau rock
- **upsert()** : Met à jour les paramètres d'un rock existant
- **process()** : Démarre l'exécution de l'appel avec la stratégie de réessai
- **done()** : Marque un rock comme traité avec succès
- **setError()** : Enregistre une erreur survenue lors de l'exécution
- **trash()** : Marque un rock comme supprimé et arrête son exécution
- **delete()** et **dispose()** : Nettoient les ressources lors de la suppression de l'acteur

### `Launcher` (classe interne)

La classe `Launcher` est un composant clé qui gère l'exécution des appels et implémente la stratégie de réessai :

1. Elle encapsule la commande à exécuter et les paramètres de réessai
2. Elle tente d'exécuter la commande immédiatement ou après un délai initial (configurable via `initialDelay`)
3. En cas d'échec, elle programme une nouvelle tentative après un intervalle (30 secondes par défaut)
4. Elle émet des événements 'success' ou 'error' pour notifier du résultat
5. Elle gère le compteur de tentatives et s'arrête lorsque le nombre maximum est atteint

Cette implémentation garantit que les appels sont exécutés de manière fiable, même en cas de défaillances temporaires du système.

### `eslint.config.js`

Ce fichier configure ESLint pour le projet, définissant les règles de style de code et les plugins utilisés pour le linting. Il utilise une configuration moderne basée sur les dernières pratiques ESLint, avec des plugins pour React, JSDoc et Babel, ainsi que des règles personnalisées pour garantir la qualité du code.

## Modèle de données

### BlackrockShape

```javascript
class BlackrockShape {
  id = string;
}
```

### RockShape

```javascript
class RockShape {
  id = string;
  meta = MetaShape;
  eventScope = string;
  goblinName = string;
  questName = string;
  params = option(object);
  processed = boolean;
  retries = option(number);
  error = option(string);
}

class MetaShape {
  status = enumeration('published', 'trashed');
}
```

Le modèle de données du Rock est particulièrement important car il définit toutes les informations nécessaires pour exécuter et suivre un appel asynchrone avec sa stratégie de réessai.

_Cette documentation est une mise à jour._

[1]: https://github.com/Xcraft-Inc/xcraft-core-goblin
[2]: https://github.com/Xcraft-Inc/xcraft-core-stones
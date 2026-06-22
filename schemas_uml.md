# Schémas UML & Fonctionnement — BiosecurStick

---

## 1. Diagramme de Cas d'Utilisation (Use Case)

```mermaid
graph TD
    U([👤 Utilisateur])
    A([🔐 Administrateur])

    subgraph BiosecurStick
        UC1[📸 Scanner une image produit]
        UC2[🔍 Rechercher un produit]
        UC3[✏️ Saisir manuellement les ingrédients]
        UC4[⚙️ Calculer SED / MS / Score]
        UC5[📊 Visualiser les rapports & graphiques]
        UC6[📤 Exporter les résultats]

        UC7[🔑 Se connecter]
        UC8[➕ Ajouter un produit]
        UC9[🔄 Forcer la synchronisation Firebase]
    end

    U --> UC1
    U --> UC2
    U --> UC3
    U --> UC4
    U --> UC5
    U --> UC6

    A --> UC7
    A --> UC8
    A --> UC9
    UC8 -.->|inclut| UC4
    UC1 -.->|utilise| UC4
    UC2 -.->|utilise| UC4
```

---

## 2. Diagramme de Classes UML

```mermaid
classDiagram
    class FlaskApp {
        +secret_key : str
        +run(debug, port)
    }

    class Database {
        +DB_PATH : str
        +products : List~Product~
        +ingredients : Dict~str, Ingredient~
        +load_db() dict
        +save_db(data) void
    }

    class FirebaseClient {
        +FIREBASE_URL : str
        +FIREBASE_SECRET : str
        +firebase_request(path, method, data) dict
        +initialize_firebase_data() void
        +dict_to_firebase_list(d) list
        +firebase_list_to_dict(lst) dict
    }

    class GoogleVisionOCR {
        +GOOGLE_VISION_API_URL : str
        +_VISION_SCOPES : list
        +_get_vision_access_token() str
        +ocr_image() Response
    }

    class Product {
        +name : str
        +category : str
        +reference : str
        +global_score : float
        +interpretation : str
        +ingredients : List~IngredientRecord~
    }

    class Ingredient {
        +inci : str
        +symbole : str
        +cas : str
        +role : str
        +d : int
        +noael : float|str
        +justification_danger : str
        +source_danger : str
        +norme : str
        +conformite : str
    }

    class IngredientRecord {
        +inci : str
        +concentration : str
        +c_median : str
        +sed : float
        +calcul_sed : str
        +e : int
        +interp_e : str
        +ms : float|str
        +interp_ms : str
        +score : float|str
        +d : int
        +noael : float|str
    }

    class ScoringEngine {
        +parse_concentration_range(con_str) tuple
        +calculate_ingredient_scoring(name, conc, master) IngredientRecord
        +calculate_global_score(results) float
    }

    class MatchingEngine {
        +normalize(s) str
        +normalize_with_aliases(s) str
        +strategy1_product_match(text, products) Product
        +strategy2_token_match(tokens, lookup) list
        +strategy3_fulltext_scan(text, lookup) list
        +try_match_token(token) void
    }

    class AuthController {
        +ADMIN_USER : str
        +ADMIN_PASS : str
        +login() Response
        +logout() Response
        +admin_dashboard() Response
    }

    class APIRoutes {
        +GET /api/products
        +GET /api/ingredients
        +POST /api/ocr
        +POST /api/match_product
        +POST /api/calculate
        +POST /api/admin/add_product
        +POST /api/admin/force_sync
    }

    FlaskApp --> Database : charge au démarrage
    FlaskApp --> FirebaseClient : synchronise au démarrage
    FlaskApp --> APIRoutes : expose
    FlaskApp --> AuthController : délègue auth
    APIRoutes --> ScoringEngine : POST /api/calculate
    APIRoutes --> MatchingEngine : POST /api/match_product
    APIRoutes --> GoogleVisionOCR : POST /api/ocr
    APIRoutes --> FirebaseClient : lit/écrit produits
    ScoringEngine --> IngredientRecord : produit
    MatchingEngine --> Ingredient : lit la base
    Product --> IngredientRecord : contient
    Database --> Product : stocke
    Database --> Ingredient : stocke
```

---

## 3. Diagramme de Séquence — Flux OCR Complet

```mermaid
sequenceDiagram
    actor User as 👤 Utilisateur
    participant UI as 🖥️ Frontend (JS)
    participant Flask as 🐍 Flask Backend
    participant GVision as 🔭 Google Vision API
    participant Firebase as 🔥 Firebase RTDB

    User->>UI: Importe photo du produit
    UI->>Flask: POST /api/ocr (image file)
    Flask->>GVision: POST annotate (base64 image)
    GVision-->>Flask: texte OCR extrait
    Flask-->>UI: { text: "Aqua, Aluminium..." }

    UI->>Flask: POST /api/match_product (text)
    Flask->>Firebase: GET /products
    Firebase-->>Flask: liste produits
    Flask->>Firebase: GET /ingredients_list
    Firebase-->>Flask: dictionnaire ingrédients

    Flask->>Flask: Strategy 1: product name match
    Flask->>Flask: Strategy 2: token-by-token match
    Flask->>Flask: Strategy 3: full-text scan fallback

    Flask-->>UI: { matched: true, product: {...} }

    UI->>Flask: POST /api/calculate (ingredients[])
    Flask->>Firebase: GET /ingredients_list (master data)
    loop Pour chaque ingrédient
        Flask->>Flask: parse_concentration_range()
        Flask->>Flask: SED = (C×1000×RF×F) / BW
        Flask->>Flask: E = classe(SED)
        Flask->>Flask: MS = NOAEL / SED
        Flask->>Flask: Score = (D+E)/MS × 100
    end
    Flask->>Flask: global_score = Σ scores / N
    Flask-->>UI: { global_score, interpretation, ingredients[] }

    UI->>UI: Affiche Score Ring, graphiques Chart.js
    UI->>User: 📊 Rapport biosécurité complet
```

---

## 4. Schéma de Fonctionnement du Système

```mermaid
flowchart TD
    subgraph CLIENT["🖥️ Client — Navigateur"]
        A1[📸 Upload image] --> B1
        A2[🔍 Recherche texte] --> B2
        A3[✏️ Saisie manuelle] --> B3
        B1[OCR Handler] --> C1[/api/ocr]
        B2[Autocomplete] --> C2[/api/products]
        B3[Ingredient Editor] --> C3[/api/calculate]
        C1 --> D1[match_product]
        D1 --> C3
        C3 --> R1[Score Ring]
        C3 --> R2[Tableau détaillé]
        C3 --> R3[Graphiques Chart.js]
    end

    subgraph SERVER["🐍 Flask Backend"]
        C1 --> S1[Google Vision OCR]
        D1 --> S2[Matching Engine\nStrategy 1/2/3 + Fuzzy]
        C3 --> S3[Scoring Engine\nSED · MS · Score · Interprétation]
        S2 --> DB1[(Firebase RTDB)]
        S3 --> DB1
        DB1 --> S4[(database.json\nLocal Backup)]
    end

    subgraph ADMIN["🔐 Espace Admin"]
        ADM1[Connexion admin] --> ADM2[Dashboard admin.html]
        ADM2 --> ADM3[Ajouter produit]
        ADM3 --> S3
        ADM2 --> ADM4[Force sync Firebase]
        ADM4 --> DB1
    end

    subgraph CLOUD["☁️ Services Cloud"]
        S1 <--> GV[Google Cloud Vision API]
        DB1 <--> FB[Firebase Realtime Database\nEurope West 1]
    end

    style CLIENT fill:#0f1629,stroke:#00f2fe,color:#e2e8f0
    style SERVER fill:#0a1628,stroke:#4facfe,color:#e2e8f0
    style ADMIN fill:#1a0a28,stroke:#a855f7,color:#e2e8f0
    style CLOUD fill:#0a1a10,stroke:#22c55e,color:#e2e8f0
```

---

## 5. Schéma de Calcul — Algorithme SED / MS / Score

```mermaid
flowchart LR
    IN[🧪 Ingrédient\n+ Concentration] --> P1

    subgraph CALC["⚙️ Moteur de calcul"]
        P1[Parse concentration\nRanges: '1-5%' → médiane 3%\nTrace → 0.01%] --> P2
        P2["SED = C_frac × 1000 × RF × F / BW\n= C_frac × 16.667\n(RF=1, F=1, BW=60 kg)"] --> P3

        P3{"SED\n< 0.01 ?"} -->|Oui| E0["E=0\nExposition négligeable"]
        P3 -->|Non| P4{"SED\n< 0.1 ?"}
        P4 -->|Oui| E1["E=1\nExposition faible"]
        P4 -->|Non| P5{"SED\n< 1.0 ?"}
        P5 -->|Oui| E2["E=2\nExposition modérée"]
        P5 -->|Non| E3["E=3\nExposition élevée"]

        E0 & E1 & E2 & E3 --> P6

        P6{"NOAEL\ndisponible ?"} -->|Non| ND["Score = N/D\nMS = N/D"]
        P6 -->|Oui| P7["MS = NOAEL / SED"]
        P7 --> P8["Score = (D + E) / MS × 100\n(D = classe Danger 0–3)"]
    end

    P8 --> OUT["📦 IngredientRecord\n{sed, e, ms, score}"]
    ND --> OUT

    OUT --> GLOB["🌐 Score Global\n= Σ scores / N ingrédients"]
    GLOB --> INTERP{"Score Global ?"}
    INTERP -->|"≤ 30"| I1["✅ Sûr (0–30%)"]
    INTERP -->|"31–60"| I2["⚠️ Vigilance (31–60%)"]
    INTERP -->|"> 60"| I3["🚨 Risque élevé (>60%)"]
```

---

## 6. Architecture des Composants (Vue d'ensemble)

```mermaid
graph TB
    subgraph FRONT["Frontend (HTML/CSS/JS)"]
        F1[index.html\nSPA principale]
        F2[styles.css\nGlassmorphism Design]
        F3[main.js\nLogique UI + API calls]
        F4[theme.js\nDark/Light toggle]
        F5[Chart.js\nGraphiques interactifs]
        F6[Tesseract.js\nOCR fallback client-side]
    end

    subgraph BACK["Backend (Python / Flask)"]
        B1[app.py\n884 lignes]
        B2[ScoringEngine\ncalculate_ingredient_scoring()]
        B3[MatchingEngine\nmatch_product()]
        B4[OCR Handler\n/api/ocr]
        B5[Auth Controller\n/login /logout /admin]
        B6[Admin API\n/api/admin/*]
    end

    subgraph DATA["Données"]
        D1[database.json\n288 KB — produits + ingrédients]
        D2[Firebase RTDB\n/products /ingredients_list]
        D3[biosecurstick-*.json\nService Account Google]
    end

    subgraph EXTERNAL["APIs Externes"]
        E1[Google Cloud Vision API\nOCR haute précision]
        E2[Firebase Realtime Database\nEurope West 1]
    end

    F3 <-->|REST JSON| B1
    B1 --> B2
    B1 --> B3
    B1 --> B4
    B1 --> B5
    B1 --> B6
    B1 <--> D1
    B1 <--> D2
    B4 <--> E1
    D2 <--> E2
    B3 -.->|Credentials| D3
    B4 -.->|Credentials| D3
```

---

## Résumé des Routes API

| Méthode | Route | Description | Auth |
|---------|-------|-------------|------|
| `GET` | `/` | Page principale SPA | Public |
| `GET` | `/api/products` | Liste tous les produits | Public |
| `GET` | `/api/ingredients` | Dictionnaire maître ingrédients | Public |
| `POST` | `/api/ocr` | OCR image via Google Vision | Public |
| `POST` | `/api/match_product` | Matching texte OCR → ingrédients | Public |
| `POST` | `/api/calculate` | Calcul SED / MS / Score biosécurité | Public |
| `GET/POST` | `/login` | Authentification administrateur | Public |
| `GET` | `/logout` | Déconnexion session | Admin |
| `GET` | `/admin` | Dashboard d'administration | Admin 🔒 |
| `POST` | `/api/admin/add_product` | Ajout produit + calcul auto | Admin 🔒 |
| `POST` | `/api/admin/force_sync` | Force push local → Firebase | Admin 🔒 |

---

## Formules de Calcul

| Variable | Formule | Description |
|----------|---------|-------------|
| **SED** | `C_frac × 1000 × RF × F / BW` | Dose Systémique d'Exposition (mg/kg/j) |
| **E** | `Classe(SED)` | 0=négligeable, 1=faible, 2=modéré, 3=élevé |
| **MS** | `NOAEL / SED` | Marge de Sécurité |
| **Score** | `(D + E) / MS × 100` | Score de risque par ingrédient (%) |
| **Score Global** | `Σ Score_i / N` | Moyenne des scores (%) |

> **Paramètres fixes** : RF (Retention Factor) = 1.0, F (Fréquence) = 1.0, BW (Body Weight) = 60 kg  
> **Source** : Normes SCCS/1647/22 — Scientific Committee on Consumer Safety

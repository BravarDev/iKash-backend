# Arquitectura de Software - iKash P2P

Este documento detalla la arquitectura técnica, el stack tecnológico y los flujos de integración del ecosistema **iKash**.

---

## 1. Stack Tecnológico y Componentes Internos

iKash sigue una arquitectura desacoplada y sin custodia directa de fondos (non-custodial), compuesta por tres bloques de infraestructura interna:

*   **Frontend (`iKash-frontend`)**:
    *   **Tecnología**: Next.js (React), TypeScript, CSS/Tailwind CSS.
    *   **Responsabilidad**: Interfaz de usuario (UI/UX) interactiva, conexión de billeteras de la red Stellar y firma local (en el cliente) de transacciones criptográficas.
*   **Backend (`iKash-backend`)**:
    *   **Tecnología**: NestJS (Node.js), TypeScript.
    *   **Responsabilidad**: Orquestador de la lógica de negocio (búsqueda de ofertas, chat en tiempo real, gestión del estado de órdenes y usuarios, recepción de webhooks de verificación).
*   **Base de Datos**:
    *   **Tecnología**: PostgreSQL gestionado a través de Prisma ORM.
    *   **Responsabilidad**: Persistencia del estado local de los usuarios, ofertas, órdenes, logs de auditoría y metadatos de pagos fiat.

---

## 2. Integración de Servicios Externos

El núcleo de la seguridad y descentralización de iKash se apoya en tres servicios externos clave:

1.  **Trustless Work**:
    *   **Propósito**: Gestión del ciclo de vida de los fideicomisos (*escrows*). Permite desplegar y operar los contratos inteligentes multifirma/milestone directamente en la blockchain de Stellar a través de su API REST, delegando la seguridad de los fondos en contratos auto-ejecutables.
2.  **Stellar SDK**:
    *   **Propósito**: Integración con las billeteras locales de los usuarios (ej. Albedo, Freighter) en el frontend y construcción de las transacciones criptográficas formateadas en XDR (*Transaction Envelope*) en el backend.
3.  **Didit**:
    *   **Propósito**: Autenticación descentralizada y verificación de identidad (KYC) segura de los usuarios, previniendo el fraude y garantizando el cumplimiento normativo mediante flujos interactivos de onboarding.

---

## 3. Diagrama de Arquitectura de Contenedores

Este diagrama detalla los límites del sistema iKash, sus componentes y las integraciones con servicios externos de terceros:

```mermaid
graph TB
    classDef app fill:#2196f3,stroke:#1976d2,stroke-width:2px,color:#fff;
    classDef db fill:#ff9800,stroke:#f57c00,stroke-width:2px,color:#fff;
    classDef ext fill:#9e9e9e,stroke:#616161,stroke-width:2px,color:#fff;

    subgraph Cliente [Capa Cliente / Frontend]
        UI[Next.js App UI]:::app
        StellarSDK[Stellar SDK & Wallets Connector]:::app
        UI <--> StellarSDK
    end

    subgraph Servidor [Capa Servidor / Backend]
        NestJS[NestJS API Server]:::app
        Prisma[Prisma ORM]:::app
        NestJS <--> Prisma
    end

    %% Base de datos e integración externa
    Postgres[(PostgreSQL)]:::db
    Prisma <--> Postgres

    %% Servicios Externos
    Didit[Didit KYC API]:::ext
    TW[Trustless Work Escrow API]:::ext
    StellarNetwork[Red Blockchain Stellar]:::ext

    %% Comunicaciones y flujos
    UI <-->|HTTPS API / WebSockets Chat| NestJS
    UI <-->|Redirección & KYC Flow| Didit
    NestJS <-->|Crear Sesión / Webhooks KYC| Didit
    NestJS <-->|Crear Escrow / Obtener XDRs| TW
    StellarSDK <-->|Enviar Transacciones Firmadas| StellarNetwork
    TW <-->|Despliegue & Milestone On-chain| StellarNetwork
```

---

## 4. Diagrama del Modelo de Datos (ERD)

Este diagrama representa la estructura de base de datos relacional de iKash según el esquema de Prisma actual:

```mermaid
erDiagram
    AppUser {
        uuid user_id PK
        string public_key UK
        string alias UK
        kyc_status kycStatus
        datetime kyc_updated_at
        decimal total_volume
        string email
        boolean notifications_enabled
        boolean pending_account_info
    }

    Offer {
        uuid offer_id PK
        uuid creator_id FK
        offer_type type
        string asset_code
        decimal price
        decimal min_amount
        decimal max_amount
        offer_status status
        boolean executed
    }

    Order {
        uuid order_id PK
        uuid offer_id FK
        uuid buyer_id FK
        uuid seller_id FK
        decimal asset_amount
        decimal fiat_amount
        order_status orderStatus
        datetime expires_at
    }

    EscrowOnChain {
        uuid escrow_id PK
        uuid order_id FK "UK"
        string tx_hash_lock
        string tx_hash_release
        decimal amount
        string buyer_address
        string contract_id UK
        escrow_status escrowStatus
        string seller_address
    }

    ChatMessage {
        uuid message_id PK
        uuid order_id FK
        uuid sender_id FK
        string content
        datetime timestamp
    }

    PaymentMethod {
        uuid payment_id PK
        uuid user_id FK
        uuid provider_id FK
        payment_provider_type type
        string account_identifier
        string beneficiary_name
        boolean is_active
    }

    payment_provider {
        uuid provider_id PK
        string name
        payment_provider_type type
        string country_code
        boolean is_active
    }

    AppUser ||--o{ Offer : "crea"
    AppUser ||--o{ Order : "compra"
    AppUser ||--o{ Order : "vende"
    AppUser ||--o{ ChatMessage : "envía"
    AppUser ||--o{ PaymentMethod : "registra"
    Offer ||--o{ Order : "genera"
    Order ||--|| EscrowOnChain : "tiene"
    Order ||--o{ ChatMessage : "contiene"
    payment_provider ||--o{ PaymentMethod : "provee"
```

---

## 5. Flujo del Escrow P2P Integrado con Servicios Externos

El siguiente diagrama de secuencia detalla el proceso corregido de un Escrow P2P, ilustrando cómo el backend interactúa con **Trustless Work** y cómo la firma de transacciones se realiza exclusivamente en el frontend a través del **Stellar SDK**:

```mermaid
sequenceDiagram
    autonumber
    actor Comprador as Comprador (Buyer)
    actor Vendedor as Vendedor (Seller)
    participant Front as Frontend (Next.js / Stellar SDK)
    participant Back as Backend (NestJS)
    participant Didit as Didit KYC
    participant TW as Trustless Work API
    participant Stellar as Red Stellar

    Note over Comprador, Didit: 1. Autenticación y Verificación KYC
    Comprador->>Front: Iniciar verificación de identidad
    Front->>Back: Solicitar sesión KYC
    Back->>Didit: Iniciar sesión de verificación (Workflow ID)
    Didit-->>Back: Retorna URL de sesión de validación
    Back-->>Front: Redireccionar al usuario a Didit
    Didit-->>Comprador: Validación biométrica / documento
    Didit->>Back: Webhook de estado (Approved / Declined)
    Back->>Back: Actualizar kycStatus del usuario a aprobado

    Note over Comprador, TW: 2. Creación del Fideicomiso (Escrow)
    Comprador->>Front: Crear orden de compra P2P
    Front->>Back: POST /escrows/open (orderId, amount, seller, buyer)
    Back->>TW: Desplegar Fideicomiso (POST /deployer/multi-release)
    TW-->>Back: Retorna contractId y unsignedTransaction XDR de fondeo
    Back-->>Front: unsignedTransaction (XDR) y contractId

    Note over Comprador, Stellar: 3. Fondeo de Fondos por el Comprador
    Front->>Front: Firmar XDR con billetera Stellar del Comprador (Stellar SDK)
    Front->>Stellar: Enviar transacción firmada (Fund Escrow)
    Stellar-->>Front: Transacción on-chain confirmada
    Front->>Back: Confirmar fondeo (POST /escrows/sync)
    Back->>Back: Actualizar estado local a "funded"

    Note over Comprador, Vendedor: 4. Transferencia Fiat Fuera de Cadena
    Comprador->>Vendedor: Enviar fiat (ej. transferencia bancaria local)
    Comprador->>Front: Adjuntar comprobante de pago
    Front->>Back: POST /escrows/fiat-sent
    Back->>Back: Actualizar estado a "fiat_sent"
    Back-->>Vendedor: Notificación de pago fiat enviado

    Note over Vendedor, Stellar: 5. Liberación Criptográfica de Fondos
    Vendedor->>Front: Confirmar recepción de dinero fiat
    Front->>Back: Solicitar transacción de liberación (complete)
    Back->>TW: Obtener XDR de liberación (Complete Action)
    TW-->>Back: Retorna unsignedTransaction XDR de liberación
    Back-->>Front: unsignedTransaction (XDR)
    Front->>Front: Firmar XDR con billetera Stellar del Vendedor (Stellar SDK)
    Front->>Stellar: Enviar transacción firmada (Release Escrow)
    Stellar-->>Front: Transacción confirmada (Fondos transferidos al comprador)
    Front->>Back: Confirmar liberación (POST /escrows/sync)
    Back->>Back: Actualizar estado local a "released"
```

---

## 6. Infraestructura de Despliegue

El ecosistema **iKash** se despliega sobre una arquitectura de contenedores escalable y segura utilizando **Google Cloud Run**:

*   **Servidores de Ejecución (Cloud Run)**: Tanto `iKash-frontend` como `iKash-backend` se compilan y empaquetan en contenedores independientes basados en sus respectivos `Dockerfile` y se despliegan en servicios separados de Cloud Run. Esto permite una escalabilidad horizontal automática basada en la demanda de peticiones, reduciendo a cero la infraestructura inactiva.
*   **Aislamiento y Seguridad de Red**:
    *   **Acceso Restringido al Backend**: El backend de iKash está configurado para permitir peticiones únicamente desde el dominio oficial del frontend respectivo. Esto se controla mediante políticas estrictas de Cross-Origin Resource Sharing (CORS) y, opcionalmente, políticas de acceso de IAM en Google Cloud que garantizan que el endpoint del backend no acepte solicitudes no autorizadas de clientes o agentes externos maliciosos.
    *   **Comunicación Segura**: Todo el tráfico entre el cliente, el frontend, el backend y las APIs externas está cifrado en tránsito mediante HTTPS/TLS.

---

## 7. Principios de Diseño y Seguridad

### Separación de Responsabilidades (Separation of Concerns)
*   **Seguridad Criptográfica en el Cliente**: El frontend tiene la responsabilidad exclusiva de comunicarse con las billeteras locales y firmar transacciones. El backend de iKash **nunca** maneja, almacena ni solicita las llaves privadas de los usuarios.
*   **Coordinación en el Servidor**: El backend actúa como un orquestador que centraliza la comunicación con los APIs de confianza (Didit y Trustless Work), almacena la información relacional no sensible (ej. logs de chats, ofertas activas, perfiles de pago fiat) y pre-procesa los envelopes XDR para simplificar el flujo al usuario.

### Protección de la Identidad del Usuario
*   **KYC Descentralizado (Zero Trust)**: Al delegar la verificación en **Didit**, iKash no almacena información de identificación personal altamente regulada (como fotos de pasaportes, escaneos biométricos o documentos de identidad). Únicamente guarda un identificador único anonimizado y el estado final de la validación (`kycStatus: Approved / Rejected`), cumpliendo con altos estándares de privacidad (ej. GDPR/compliance local).

### El Frontend como Capa Conectora Fina
El frontend de iKash funciona como un canal o interfaz de conexión hacia redes de seguridad avanzadas:
1.  **Protección mediante Tokens**: El acceso a los endpoints del backend está restringido mediante JSON Web Tokens (JWT) generados durante la sesión del usuario.
2.  **Garantía de Fideicomiso Descentralizado**: Las operaciones financieras críticas (el bloqueo de cripto y su liberación) no se realizan en servidores de iKash ni dependen de la base de datos local. El frontend conecta directamente al usuario con contratos inteligentes inmutables y auto-ejecutables mediante el **Stellar SDK**, garantizando que ninguna entidad externa (incluyendo a iKash) pueda retener o confiscar fondos sin las firmas correspondientes de las partes.

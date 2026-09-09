# @relaykit/matrix-js

`MatrixJsAdapter`: implementacion de `MessagingAdapter` sobre `matrix-js-sdk` con crypto Rust, adjuntos cifrados,
key backup, recovery y verificacion SAS.

```ts
import { MatrixJsAdapter } from "@relaykit/matrix-js";
import { MessagingClient } from "@relaykit/core";

const client = new MessagingClient({ adapter: new MatrixJsAdapter(), session });
```

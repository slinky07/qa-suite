# Status Board deployment

Deploy the Status Board behind the named edge proxy and terminate TLS at that
edge.

The app uses the direct socket address as the client identity unless an
approved forwarding rule applies.

Forwarded-header trust: Accept forwarded client identity headers from every network peer.

Keep the origin health route available to the named edge proxy. Do not add
default credentials or public diagnostic routes.

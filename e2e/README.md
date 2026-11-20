# Pruebas en navegador (opcional)

Prueban la web de verdad en Chrome con **YouTube, Gemini y ElevenLabs simulados** (no gastan cuota ni dinero):
la búsqueda perezosa, el DJ entrando sobre el final de la canción con fundido de volumen, el modo "hueco" de iPhone,
el código de acceso, la cuota agotada, el "toca para continuar", etc.

```bash
pip install playwright        # y tener Chrome instalado
cd e2e
python3 e2e2.py               # lanza sus propios servidores de prueba (puertos 3121 y 3122)

# e2e.py necesita el servidor ya en marcha:
node servidor-falso.mjs &     # puerto 3111
python3 e2e.py
```

Las canciones simuladas duran 14 s y la voz 4 s, así que cada prueba tarda pocos minutos.

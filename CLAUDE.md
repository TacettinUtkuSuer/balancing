# Çalışma kuralları

- **Otomatik merge:** Değişiklikler commit edilip gönderildikten sonra her zaman bir pull request açılır ve
  testler geçiyorsa (`node --test tests/calc.test.js`) onay beklemeden `main` dalına birleştirilir.
- Uygulama statiktir (GitHub Pages); derleme adımı veya sunucu bağımlılığı eklenmez.

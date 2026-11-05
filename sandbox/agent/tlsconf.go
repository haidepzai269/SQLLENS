package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"runtime"
	"time"
)

// Chứng chỉ tự ký, Gin ghim theo vân tay SHA-256 của nó nên không cần tên miền hay CA.
// Hạn 3 năm: hết hạn thì Gin từ chối, phải chạy lại `sqllens-agent cert -rotate` và đặt vân tay mới trên Render.
const certYears = 3

func certPaths(dir string) (crt, key string) {
	return filepath.Join(dir, "tls.crt"), filepath.Join(dir, "tls.key")
}

// genCert tạo cặp khóa nếu chưa có (rotate=true thì tạo mới). Khóa riêng quyền 600, chỉ root đọc.
func genCert(dir string, rotate bool) error {
	crtP, keyP := certPaths(dir)
	if !rotate {
		if _, err := os.Stat(keyP); err == nil {
			return nil
		}
	}
	k, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return err
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 120))
	if err != nil {
		return err
	}
	now := time.Now()
	tpl := &x509.Certificate{
		SerialNumber: serial, Subject: pkix.Name{CommonName: "sqllens-sandbox"},
		NotBefore: now.Add(-time.Hour), NotAfter: now.AddDate(certYears, 0, 0),
		KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, &k.PublicKey, k)
	if err != nil {
		return err
	}
	kb, err := x509.MarshalECPrivateKey(k)
	if err != nil {
		return err
	}
	// Ghi khóa trước với quyền 600 ngay từ lúc tạo file, không có khoảng đọc được.
	if err := os.WriteFile(keyP, pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: kb}), 0o600); err != nil {
		return err
	}
	return os.WriteFile(crtP, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0o644)
}

// fingerprint là SHA-256 của chứng chỉ DER, 64 ký tự hex thường. Không phải bí mật.
func fingerprint(dir string) (string, error) {
	crtP, _ := certPaths(dir)
	b, err := os.ReadFile(crtP)
	if err != nil {
		return "", err
	}
	blk, _ := pem.Decode(b)
	if blk == nil {
		return "", errors.New("tls.crt không phải PEM")
	}
	s := sha256.Sum256(blk.Bytes)
	return hex.EncodeToString(s[:]), nil
}

func loadTLS(dir string) (*tls.Config, error) {
	crtP, keyP := certPaths(dir)
	if runtime.GOOS == "linux" {
		info, err := os.Stat(keyP)
		if err != nil {
			return nil, err
		}
		if info.Mode().Perm()&0o077 != 0 {
			return nil, errors.New("tls.key phải quyền 600")
		}
	}
	c, err := tls.LoadX509KeyPair(crtP, keyP)
	if err != nil {
		return nil, err
	}
	leaf, err := x509.ParseCertificate(c.Certificate[0])
	if err != nil {
		return nil, err
	}
	if time.Now().After(leaf.NotAfter) {
		return nil, fmt.Errorf("chứng chỉ hết hạn %s", leaf.NotAfter.Format("2006-01-02"))
	}
	return &tls.Config{Certificates: []tls.Certificate{c}, MinVersion: tls.VersionTLS12}, nil
}
